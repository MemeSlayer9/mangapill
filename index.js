const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { request, gql } = require('graphql-request');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

const ANILIST_API = 'https://graphql.anilist.co';

// GraphQL query to search manga on AniList
const SEARCH_MANGA_QUERY = gql`
  query ($search: String) {
    Media(search: $search, type: MANGA) {
      id
      title {
        romaji
        english
        native
      }
      description
      coverImage {
        large
        extraLarge
      }
      bannerImage
      genres
      tags {
        name
      }
      averageScore
      popularity
      status
      chapters
      volumes
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      synonyms
      siteUrl
    }
  }
`;

// Function to search AniList
async function searchAniList(mangaTitle) {
  try {
    const data = await request(ANILIST_API, SEARCH_MANGA_QUERY, { 
      search: mangaTitle 
    });
    return data.Media;
  } catch (error) {
    console.error('Error fetching from AniList:', error);
    return null;
  }
}

// ==================== MANGAPILL SCRAPERS ====================

function scrapeMangaFromHTML(html) {
  const $ = cheerio.load(html);
  const mangaList = [];

  $('.featured-grid .rounded').each((i, el) => {
    const $el = $(el);
    
    const fullPath = $el.find('a[href^="/manga/"]').attr('href');
    const id = fullPath ? fullPath.replace('/manga/', '') : null;
    const mangaID = $el.find('a').first().attr('href');
    
    // Remove /chapters prefix from mangaID
    const cleanMangaID = mangaID ? mangaID.replace('/chapters/', '') : null;
    
    const chapterNumber = $el.find('.text-lg.font-black').text().trim();
    const mangaTitle = $el.find('.text-secondary').text().trim();
    const imageUrl = $el.find('img').attr('src') || $el.find('img').attr('data-src');
    const imageAlt = $el.find('img').attr('alt');

    mangaList.push({
      id,
      chapterNumber,
      mangaID: cleanMangaID,
      mangaTitle,
      imageUrl,
      imageAlt
    });
  });

  return mangaList;
}

function scrapeChaptersPage(html) {
  const $ = cheerio.load(html);
  const chaptersList = [];
  const seenIds = new Set();

  $('.grid > div, .space-y-2 > div').each((i, el) => {
    const $el = $(el);
    
    const chapterLink = $el.find('a[href^="/chapters/"]').first();
    if (chapterLink.length === 0) return;

    const mangaID = chapterLink.attr('href');
    
    if (seenIds.has(mangaID)) return;
    seenIds.add(mangaID);

    const chapterNumber = $el.find('.text-lg.font-black').first().text().trim();
    const imageUrl = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
    const imageAlt = $el.find('img').first().attr('alt');
    
    const mangaLink = $el.find('a[href^="/manga/"]').first();
    const fullPath = mangaLink.attr('href');
    // Extract just the ID portion from /manga/6511/megami-no-caf-terrace
    const id = fullPath ? fullPath.replace('/manga/', '') : null;
    
    // Split manga title and alternative title
    const mangaTitleRaw = $el.find('.text-secondary').first().text().trim();
    const titleParts = mangaTitleRaw.split(/\n\s+/);
    const mangaTitle = titleParts[0] || null;
    const mangaTitle2 = titleParts[1] || null;
    
    const timeAgo = $el.find('time-ago').first().attr('datetime');
    
    // Remove /chapters/ prefix from mangaID
    const cleanMangaID = mangaID ? mangaID.replace('/chapters/', '') : null;
    
    if (chapterNumber && mangaTitle && cleanMangaID) {
      chaptersList.push({
        id,
        chapterNumber,
        mangaID: cleanMangaID,
        mangaTitle,
        ...(mangaTitle2 && { mangaTitle2 }),
        imageUrl,
        imageAlt,
        publishedAt: timeAgo
      });
    }
  });

  return chaptersList;
}
function scrapeMangaDetails(html) {
  const $ = cheerio.load(html);
  
  const title = $('h1').text().trim();
  const image = $('.flex-shrink-0 img').attr('src') || $('.flex-shrink-0 img').attr('data-src');
  const description = $('.text-sm.text--secondary').text().trim();
  
  const type = $('.grid.grid-cols-1 > div:nth-child(1) > div').text().trim();
  const status = $('.grid.grid-cols-1 > div:nth-child(2) > div').text().trim();
  const year = $('.grid.grid-cols-1 > div:nth-child(3) > div').text().trim();
  
  const genres = [];
  $('a[href^="/search?genre="]').each((i, el) => {
    genres.push($(el).text().trim());
  });
  
  const chapters = [];
  $('#chapters a[href^="/chapters/"]').each((i, el) => {
    const $el = $(el);
    chapters.push({
      title: $el.text().trim(),
      link: $el.attr('href'),
      fullTitle: $el.attr('title')
    });
  });
  
  return {
    title,
    image,
    description,
    type,
    status,
    year,
    genres,
    chapters,
    totalChapters: chapters.length
  };
}

function scrapeTrendingMangas(html) {
  const $ = cheerio.load(html);
  const trendingList = [];
  const seenIds = new Set();

  $('.grid > div').each((i, el) => {
    const $el = $(el);
    
    const mangaLink = $el.find('a[href^="/manga/"]').first().attr('href');
    if (!mangaLink) return;
    
    if (seenIds.has(mangaLink)) return;
    seenIds.add(mangaLink);

    const title = $el.find('.font-black.leading-tight').text().trim();
    const alternativeTitle = $el.find('.text-xs.text-secondary').text().trim();
    const imageUrl = $el.find('img').attr('src') || $el.find('img').attr('data-src');
    const imageAlt = $el.find('img').attr('alt');
    
    if (!title || title.includes('#') || title.length < 2) {
      console.warn(`Skipping entry with corrupted title: ${title}`);
      return;
    }
    
    if (alternativeTitle && (alternativeTitle.match(/^\d{4}-\d{2}-\d{2}/) || alternativeTitle.includes('#'))) {
      console.warn(`Skipping entry with corrupted alternativeTitle: ${alternativeTitle}`);
      return;
    }
    
    const tags = [];
    $el.find('.text-xs.leading-5.font-semibold').each((j, tag) => {
      const tagText = $(tag).text().trim();
      if (tagText) tags.push(tagText);
    });
    
    // Extract ID by removing /manga/ prefix
    const id = mangaLink.replace('/manga/', '');
    
    if (title && mangaLink) {
      trendingList.push({
        id,
        title,
        alternativeTitle: (alternativeTitle && alternativeTitle.length > 0) ? alternativeTitle : null,
        imageUrl: imageUrl || null,
        imageAlt: imageAlt || null,
        type: tags[0] || null,
        year: tags[1] || null,
        status: tags[2] || null,
        link: mangaLink
      });
    }
  });

  return trendingList;
}

// ==================== MANGAFIRE SCRAPERS ====================

function scrapeMangaFireInfo(html) {
  const $ = cheerio.load(html);
  
  const res = {
    mangaInfo: {
      title: null,
      altTitles: null,
      poster: null,
      status: null,
      type: null,
      description: null,
      author: null,
      published: null,
      genres: [],
      rating: null,
      chapters: []
    },
    relatedManga: [],
    similarManga: []
  };

  try {
    // Extract main manga info
    res.mangaInfo.title = $('h1[itemprop="name"]').text().trim() || null;
    res.mangaInfo.altTitles = $('h1[itemprop="name"]').siblings('h6').text().trim() || null;
    res.mangaInfo.poster = $('.poster img')?.attr('src')?.trim() || null;
    res.mangaInfo.status = $('.info > p').first().text().trim() || null;
    res.mangaInfo.type = $('.min-info a').first().text().trim() || null;
    res.mangaInfo.description = $('.description').text().replace('Read more +', '').trim() || null;
    res.mangaInfo.author = $('.meta div:contains("Author:") a').text().trim() || null;
    res.mangaInfo.published = $('.meta div:contains("Published:")').text().replace('Published:', '').trim() || null;
    res.mangaInfo.rating = $('.rating-box .live-score').text().trim() || null;

    // Extract genres
    $('.meta div:contains("Genres:") a').each((i, el) => {
      const genre = $(el).text().trim();
      if (genre) res.mangaInfo.genres.push(genre);
    });

    // Extract chapters
    $('#chapters-list a[href*="/read/"]').each((i, el) => {
      const chapterLink = $(el).attr('href');
      const chapterTitle = $(el).text().trim();
      if (chapterTitle && chapterLink) {
        res.mangaInfo.chapters.push({
          title: chapterTitle,
          link: chapterLink
        });
      }
    });

    // Scrape similar manga from trending section
    $('section.side-manga.default-style div.original.card-sm.body a.unit').each((i, el) => {
      const manga = {
        id: $(el).attr('href')?.split('/').pop() || null,
        name: $(el).find('.info h6').text().trim() || null,
        poster: $(el).find('.poster img').attr('src')?.trim() || null
      };
      if (manga.id && manga.name) {
        res.similarManga.push(manga);
      }
    });

    return res;
  } catch (err) {
    console.error('Error scraping MangaFire:', err);
    throw new Error(`Failed to scrape MangaFire: ${err.message}`);
  }
}

// ==================== ROUTES ====================

app.get('/', (req, res) => {
  res.json({
    message: 'Manga Scraper API with AniList Integration',
    endpoints: [
      {
        method: 'GET',
        path: '/featured-mangas',
        description: 'Scrape featured manga from MangaPill homepage'
      },
      {
        method: 'GET',
        path: '/scrape-url?url=YOUR_URL',
        description: 'Scrape from custom URL',
        example: '/scrape-url?url=https://mangapill.com/'
      },
      {
        method: 'GET',
        path: '/manga-details?id=MANGA_ID',
        description: 'Get manga details from MangaPill with AniList data',
        example: '/manga-details?id=9268/who-s-that-girl'
      },
      {
        method: 'GET',
        path: '/recent-chapters',
        description: 'Scrape latest chapters from MangaPill chapters page'
      },
      {
        method: 'GET',
        path: '/trending-mangas',
        description: 'Scrape trending mangas from MangaPill'
      },
      {
        method: 'GET',
        path: '/mangafire-info?id=MANGA_ID',
        description: 'Get manga details from MangaFire',
        example: '/mangafire-info?id=the-fragrant-flower-blooms-with-dignityy.zlw6m'
      }
    ]
  });
});

// MangaPill endpoints
app.get('/featured-mangas', async (req, res) => {
  try {
    const { data } = await axios.get('https://mangapill.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const mangaList = scrapeMangaFromHTML(data);
    res.json({
      success: true,
      count: mangaList.length,
      data: mangaList
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get('/scrape-url', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ 
      error: 'URL query parameter is required',
      example: '/scrape-url?url=https://mangapill.com/'
    });
  }

  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const mangaList = scrapeMangaFromHTML(data);
    res.json({
      success: true,
      count: mangaList.length,
      data: mangaList
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get('/manga-details', async (req, res) => {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ 
      success: false,
      error: 'Manga ID parameter is required', 
      example: '/manga-details?id=9268/who-s-that-girl' 
    });
  }

  try {
    const url = `https://mangapill.com/manga/${id}`;
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const mangaDetails = scrapeMangaDetails(data);
    const anilistData = await searchAniList(mangaDetails.title);

    res.json({
      success: true,
      url: url,
      mangaPill: mangaDetails,
      anilist: anilistData
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get('/recent-chapters', async (req, res) => {
  try {
    const { data } = await axios.get('https://mangapill.com/chapters', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const chaptersList = scrapeChaptersPage(data);
    res.json({
      success: true,
      count: chaptersList.length,
      data: chaptersList
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get('/trending-mangas', async (req, res) => {
  try {
    const { data } = await axios.get('https://mangapill.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const trendingList = scrapeTrendingMangas(data);
    res.json({
      success: true,
      count: trendingList.length,
      data: trendingList
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Search manga on AniList
async function searchManga(mangaTitle) {
  try {
    const data = await request(ANILIST_API, SEARCH_MANGA_QUERY, { 
      search: mangaTitle 
    });
    return data.Media;
  } catch (error) {
    console.error('AniList Service Error:', error.message);
    return null;
  }
}

// MangaFire endpoint with AniList integration
app.get('/mangafire-info', async (req, res) => {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ 
      success: false,
      error: 'Manga ID parameter is required', 
      example: '/mangafire-info?id=the-fragrant-flower-blooms-with-dignityy.zlw6m' 
    });
  }

  try {
    const url = `https://mangafire.to/manga/${id}`;
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const mangaInfo = scrapeMangaFireInfo(data);
    
    // Search for AniList data using the manga title
    const anilistData = await searchManga(mangaInfo.mangaInfo.title);

    res.json({
      success: true,
      source: 'MangaFire',
      url: url,
      mangafire: mangaInfo,
      anilist: anilistData
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Manga scraper running on http://localhost:${PORT}`);
  console.log(`📋 Scrape featured manga: http://localhost:${PORT}/featured-mangas`);
  console.log(`🔗 Scrape custom URL: http://localhost:${PORT}/scrape-url?url=YOUR_URL`);
  console.log(`📖 Scrape manga details: http://localhost:${PORT}/manga-details?id=MANGA_ID`);
  console.log(`📚 Scrape latest chapters: http://localhost:${PORT}/recent-chapters`);
  console.log(`🔥 Scrape trending mangas: http://localhost:${PORT}/trending-mangas`);
  console.log(`🔥 Scrape MangaFire info: http://localhost:${PORT}/mangafire-info?id=MANGA_ID`);
});

module.exports = app;