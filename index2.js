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

// Scraper function for featured manga
function scrapeMangaFromHTML(html) {
  const $ = cheerio.load(html);
  const mangaList = [];

  $('.featured-grid .rounded').each((i, el) => {
    const $el = $(el);
    
    const id = $el.find('a[href^="/manga/"]').attr('href');
    const mangaID = $el.find('a').first().attr('href');
    const chapterNumber = $el.find('.text-lg.font-black').text().trim();
    const mangaTitle = $el.find('.text-secondary').text().trim();
    const imageUrl = $el.find('img').attr('src') || $el.find('img').attr('data-src');
    const imageAlt = $el.find('img').attr('alt');

    mangaList.push({
      id,
      chapterNumber,
      mangaID,
      mangaTitle,
      imageUrl,
      imageAlt
    });
  });

  return mangaList;
}

// Scraper function for chapters page
function scrapeChaptersPage(html) {
  const $ = cheerio.load(html);
  const chaptersList = [];
  const seenIds = new Set(); // Track unique manga IDs to prevent duplicates

  // Use a more specific selector targeting the chapter containers
  $('.grid > div, .space-y-2 > div').each((i, el) => {
    const $el = $(el);
    
    // Check if this div contains chapter info structure
    const chapterLink = $el.find('a[href^="/chapters/"]').first();
    if (chapterLink.length === 0) return;

    const mangaID = chapterLink.attr('href');
    
    // Skip if we've already seen this manga/chapter combination
    if (seenIds.has(mangaID)) return;
    seenIds.add(mangaID);

    const chapterNumber = $el.find('.text-lg.font-black').first().text().trim();
    const imageUrl = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
    const imageAlt = $el.find('img').first().attr('alt');
    
    const mangaLink = $el.find('a[href^="/manga/"]').first();
    const id = mangaLink.attr('href');
    const mangaTitle = $el.find('.text-secondary').first().text().trim();
    
    const timeAgo = $el.find('time-ago').first().attr('datetime');
    
    if (chapterNumber && mangaTitle && mangaID) {
      chaptersList.push({
        id,
        chapterNumber,
        mangaID,
        mangaTitle,
        imageUrl,
        imageAlt,
        publishedAt: timeAgo
      });
    }
  });

  return chaptersList;
}

// Scraper function for manga details page
function scrapeMangaDetails(html) {
  const $ = cheerio.load(html);
  
  // Extract manga info
  const title = $('h1').text().trim();
  const image = $('.flex-shrink-0 img').attr('src') || $('.flex-shrink-0 img').attr('data-src');
  const description = $('.text-sm.text--secondary').text().trim();
  
  // Extract metadata
  const type = $('.grid.grid-cols-1 > div:nth-child(1) > div').text().trim();
  const status = $('.grid.grid-cols-1 > div:nth-child(2) > div').text().trim();
  const year = $('.grid.grid-cols-1 > div:nth-child(3) > div').text().trim();
  
  // Extract genres
  const genres = [];
  $('a[href^="/search?genre="]').each((i, el) => {
    genres.push($(el).text().trim());
  });
  
  // Extract chapters
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

// Scraper function for trending mangas
// Improved scraper function for trending mangas with validation
function scrapeTrendingMangas(html) {
  const $ = cheerio.load(html);
  const trendingList = [];
  const seenIds = new Set(); // Prevent duplicates

  // Target the manga cards in the trending section
  $('.grid > div').each((i, el) => {
    const $el = $(el);
    
    // Get manga link and ID
    const mangaLink = $el.find('a[href^="/manga/"]').first().attr('href');
    if (!mangaLink) return;
    
    // Skip duplicates
    if (seenIds.has(mangaLink)) return;
    seenIds.add(mangaLink);

    // Extract manga details with validation
    const title = $el.find('.font-black.leading-tight').text().trim();
    const alternativeTitle = $el.find('.text-xs.text-secondary').text().trim();
    const imageUrl = $el.find('img').attr('src') || $el.find('img').attr('data-src');
    const imageAlt = $el.find('img').attr('alt');
    
    // Validate title - skip if corrupted or empty
    if (!title || title.includes('#') || title.length < 2) {
      console.warn(`Skipping entry with corrupted title: ${title}`);
      return;
    }
    
    // Validate alternativeTitle - skip if it's just dates
    if (alternativeTitle && alternativeTitle.match(/^\d{4}-\d{2}-\d{2}/) || alternativeTitle.includes('#')) {
      console.warn(`Skipping entry with corrupted alternativeTitle: ${alternativeTitle}`);
      return;
    }
    
    // Extract tags (type, year, status)
    const tags = [];
    $el.find('.text-xs.leading-5.font-semibold').each((j, tag) => {
      const tagText = $(tag).text().trim();
      if (tagText) tags.push(tagText);
    });
    
    // Only add if we have valid data
    if (title && mangaLink) {
      trendingList.push({
        id: mangaLink,
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

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Manga Scraper API with AniList Integration',
    endpoints: [
      {
        method: 'GET',
        path: '/scrape',
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
        path: '/manga-details?url=YOUR_URL',
        description: 'Get manga details from MangaPill with AniList data',
        example: '/manga-details?url=https://mangapill.com/manga/9268/who-s-that-girl'
      },
      {
        method: 'GET',
        path: '/chapters',
        description: 'Scrape latest chapters from MangaPill chapters page'
      },
      {
        method: 'GET',
        path: '/trending-mangas',
        description: 'Scrape trending mangas from MangaPill'
      }
    ]
  });
});

// Scrape featured manga from MangaPill homepage (GET)
app.get('/scrape', async (req, res) => {
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

// Scrape from custom URL (GET)
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

// Scrape manga details page with AniList integration (GET)
app.get('/manga-details', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ 
      error: 'URL parameter is required', 
      example: '/manga-details?url=https://mangapill.com/manga/9268/who-s-that-girl' 
    });
  }

  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const mangaDetails = scrapeMangaDetails(data);
    
    // Search for AniList data
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

// Scrape chapters page (GET)
app.get('/chapters', async (req, res) => {
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

// Scrape trending mangas (GET)
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Manga scraper running on http://localhost:${PORT}`);
  console.log(`📋 Scrape featured manga: http://localhost:${PORT}/scrape`);
  console.log(`🔗 Scrape custom URL: http://localhost:${PORT}/scrape-url?url=YOUR_URL`);
  console.log(`📖 Scrape manga details: http://localhost:${PORT}/manga-details?url=YOUR_URL`);
  console.log(`📚 Scrape latest chapters: http://localhost:${PORT}/chapters`);
  console.log(`🔥 Scrape trending mangas: http://localhost:${PORT}/trending-mangas`);
});

module.exports = app;