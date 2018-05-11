'use strict';

const P = require("bluebird");
const R = require("ramda");
const querystring = require("querystring");
const request = require("request-promise");
const fs = P.promisifyAll(require("fs"));
const { JSDOM } = require("jsdom");
const jsdiff = require("diff");

let log;
const titlesFile = 'cache/titles.json';
const cacheFile = 'cache/info.json';
const cookieFile = 'cache/cookie';
let cookie;
let allTitles;

function filter(sectionTitle) {
  return (div) => div.querySelector(".findSectionHeader").textContent == sectionTitle;
}

function loadFile(path) {
  log.debug(`Loading file at ${path}`);
  if(!fs.existsSync(path))
    throw new Error(`File ${path} not found!`);
  return JSON.parse(fs.readFileSync(path, {encoding: "utf8"}))
}

function loadJsonFile(path) {
  try {
    return JSON.parse(loadFile(path));
  } catch(e) {
    log.error(`Error: ${e.message}`);
    return {};
  }
}

function loadTitles() {
  const res = loadJsonFile(titlesFile);
  log.info(`${res.length} titles loaded`);
  return res;
}

function getCookie() {
  if(cookie != undefined)
    return cookie;
  try {
    cookie = loadFile(cookieFile);
    log.info(`Cookie loaded`);
    return cookie;
  }
  catch(e) {
    log.error(`Error: ${e.message}`);
    cookie = "";
    return "";
  }
}

function loadCache() {
  const res = loadJsonFile(cacheFile);
  log.info(`${Object.keys(res).length} items loaded from cache`);
  return res;
}

function saveCache() {
  log.debug("Saving cache");
  fs.writeFileSync(cacheFile, JSON.stringify(info));
}

const resetCache = () => {
  log.info("Resetting cache");
  info = {};
  saveCache();
};

const minWaitTime = 2000;
const mostRecentQuery = () => R.reduce(R.max, 0, R.map((e) => e.requestTime, R.values(info)));
const deltaLastQuery = () => (new Date).getTime() - mostRecentQuery();
const readyToQuery = () => deltaLastQuery() > minWaitTime;
const diff = (n1, n2) => {
  const merged = new Set();
  n1.flags.forEach(f => merged.add(f));
  n2.flags.forEach(f => merged.add(f));
  let distance = (merged.size - n1.flags.size) + (merged.size - n2.flags.size);
  const parts = R.filter(part => part.added || part.removed, jsdiff.diffWords(n1.shortTitle, n2.shortTitle, {ignoreCase: true}));
  return distance + R.reduce((cur, part) => cur + part.value.length, 0, parts);
};

async function nextQueryReady () {
  while(!readyToQuery()) {
    await new Promise((resolve) => setTimeout(() => {log.debug("Query not ready yet"); resolve();}, 500));
  }
  log.debug("Next query ready!");
}

const getFlags = (m, year) => {
  m.shortTitle = m.querySelector("a").textContent;
  m.foundTitle = m.textContent.trim();
  const str = m.foundTitle.substring(m.shortTitle.length)
  let flags = new Set();
  let matches = null;
  const regex = RegExp("\\(([^\\)]*)\\)", "g");
  log.debug("str:" + str);
  let yearFound = false;
  while ((matches = regex.exec(str)) !== null) {
    if (yearFound) {
      flags.add(matches[1]);
      log.debug(matches[1]);
    }
    if (matches[1] == year)
      yearFound = true;
  }
  m.flags = flags;
  return yearFound;
};

function bestMatchOfTwo (movie) {
  return (m1, m2) => {
    m2.distance = diff({flags: new Set(), shortTitle: movie.shortTitle}, m2);
    if (m1 === null) {
      return m2;
    }
    //if (m1.distance > m2.distance)
    //  log.highlight(`${m2.foundTitle} better than ${m1.foundTitle}`);
    return m1.distance <= m2.distance ? m1 : m2;
  };
}

function sameYear (movie) {
  return (movieNode) => getFlags(movieNode, movie.year);
}

function getDocument(uri) {
  const options = {
    method: 'GET',
    uri,
    headers: {
      "Accept-Language": "en-US,en",
      "Cookie": getCookie()
    },
    transform: (body) => (new JSDOM(body)).window.document
  };
  
  return request(options);
}

function initMovie (info, title, rank) {
  if (!info[title])
    info[title] = {title, rank};
  const movie = info[title];
  if (!movie.year)
    movie.year = RegExp("\\(([0-9]*)\\)", "g").exec(title.substring(title.lastIndexOf('(')))[1];
  if (!movie.shortTitle)
    movie.shortTitle = title.substring(0, title.lastIndexOf('(')).trim();
  return movie;
}

async function getImdb (movie) {
  if (movie.imdb) {
    log.debug(`${movie.title} in cache, skipping`);
    return movie;
  }
  await nextQueryReady();
  log.info(`Getting IMDB for ${movie.title}`);
  movie.requestTime = (new Date).getTime();
  const qs = querystring.stringify({
    ref: "nv_sr_fn",
    q: movie.title,
    s: "tt"
  });
  getDocument(`${domain}/find?${qs}`)
    .then((document) => {
      const sections = R.filter(filter("Titles"), Array.from(document.querySelectorAll("div.findSection")));
      if (sections.length != 1)
        throw new Error(`Found ${sections.length} Titles sections for ${movie.title}`);
      const section = sections[0];
      const moviesFound = R.filter(sameYear(movie), section.querySelectorAll("table.findList > tbody > tr.findResult > td.result_text"));
      const closestMatch = R.reduce(bestMatchOfTwo(movie), null, moviesFound);
      movie.foundTitle = closestMatch.foundTitle;
      movie.imdb = domain + closestMatch.querySelector("a").href;
      
      movie.distance = closestMatch.distance;
      if (movie.distance > 0)
        log.error(`Got     : ${movie.foundTitle}`,
                  `Expected: ${movie.title}`,
                  `          (diff ${movie.distance})`);
      else
        log.info(`Got ${movie.foundTitle}`);
      saveCache();
      return movie;
    })
    .catch((e) => {
      log.error(`[${movie.title}, getImdb] Got error: ${e.message}`);
      throw e;
    });
}

async function getGenre(movie) {
  if (movie.genres) {
    log.debug(`${movie.title}, genres in cache, skipping`);
    return;
  }
  await nextQueryReady();
  log.info(`Getting IMDB genres for ${movie.title}`);
  movie.requestTime = (new Date).getTime();
  movie.genres = [];
  getDocument(movie.imdb)
    .then(document => {
      const divs = R.filter(div => div.getAttribute("itemprop") === "genre", document.querySelectorAll("#titleStoryLine > div"));
      if (divs.length != 1)
        throw new Error(`Found ${divs.length} Genres divs for ${movie.title}`);
      divs[0].querySelectorAll("a").forEach(a => {
        movie.genres.push(a.textContent.trim());
      });
      log.info(`${movie.title} genres: ${movie.genres.join(', ')}`);
      saveCache();
    })
    .catch((e) => {
      log.error(`[${movie.title}, getGenres] Got error: ${e.message}`);
    });
}

async function fillCache(info) {
  const padding = titles.length.toString(10).length;
  for (let index = 0; index < titles.length; index++) {
    const title = titles[index];
    const rank = index + 1;
    log.debug(`[${rank.toString(10).padStart(padding, '0')}/${titles.length}] Processing ${title}`);
    const movie = initMovie(info, title, rank);
    await getImdb(movie).then(getGenre);
  }
  log.info("Done !");
  return info;
}

const domain = "https://www.imdb.com";
let titles;

function globalInit (argv) {
  allTitles = loadTitles();
  let nbTitles = null;
  switch(argv._.length) {
    case 0:
      nbTitles = allTitles.length;
      break;
    case 1:
      nbTitles = parseInt(argv._[0]);
      break;
    default:
      log.error("Too many arguments!");
      break;
  }
  if (!nbTitles || nbTitles > allTitles.length) {
    log.error(`nbTitles: ${nbTitles}, exiting`);
    return;
  }
  if (argv.reset) {
    resetCache();
  }
  else {
    info = loadCache();
  }
  titles = allTitles.slice(0, nbTitles);
}

let info = {};
module.exports = {
  init: (logger, argv) => {log = logger.log; globalInit(argv);},
  getMovieInfo: () => fillCache(info)
};
