'use strict';

const express = require('express');
const P = require("bluebird");
const R = require("ramda");
const {init, getMovieInfo} = require('./movies.js');
const logger = require("./logger.js");
const log = logger.log;
const yargs = require('yargs');

let movieList = null;
const setMovieList = (movies) => { movieList = movies; };

function getMovies(filter) {
  return presentToPancake(R.filter(filter, movieList));
}

function loadMovies () {
  if (movieList === null)
    return getMovieInfo().then(setMovieList);
  return P.resolve();
}

function listMovies () {
  log.info("Starting load");
  return loadMovies ();
}

function presentToPancake(movies) {
  const columns = ["rank", "title", "genres"];
  let res = '<html><body><table border="1">';
  res += "<thead>" + columns.map(k => `<td><b>${k}</b></td>`).join('') + "</thead>";
  res += "<tbody>";
  for (let movie of R.values(movies)) {
    res += "<tr>";
    res += columns.map(k => `<td>${movie[k]}</td>`).join('');
    res += "</tr>";
  }
  res += "</tbody>"
  res += "</table></body></html>";
  return res;
}

const argv = yargs
  .default('log', 'info')
  .choices('log', logger.logLevels)
  .argv;
logger.setThreshold(argv.log);
init(logger, argv);

const app = express();

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  log.info(`${req.ip} ${req.method} ${req.originalUrl}`); next();
  next();
});

app.get('/', (req, res, next) => {
  res.send('Hello Pancake!');
  next();
});
app.get('/movies',
  (req, res, next) => {
    loadMovies().then(next);
  },
  (req, res, next) => {
    res.send(getMovies(R.always(true)));
    next();
  }
);
app.get('/movies/genre/:genre',
  (req, res, next) => {
    loadMovies().then(next);
  },
  (req, res, next) => {
    res.send(getMovies(movie => R.contains(req.params.genre, movie.genres)));
    next();
  }
);
app.get('/api/movies',
  (req, res, next) => {
    loadMovies().then(next);
  },
  (req, res, next) => {
    res.json(R.values(movieList));
    next();
  }
);

const port = 16713;
app.listen(port, () => log.info(`Example app listening on port ${port}!`));
