'use strict';
const dateFormat = require('dateformat');
const R = require("ramda");

const now = () => dateFormat("HH:MM:ss.l");
let logThreshold = "info";

const nodeColors = {
  fgBlack: "\x1b[30m",
  fgRed: "\x1b[31m",
  fgGreen: "\x1b[32m",
  fgYellow: "\x1b[33m",
  fgBlue: "\x1b[34m",
  fgMagenta: "\x1b[35m",
  fgCyan: "\x1b[36m",
  fgWhite: "\x1b[37m",
  reset: "\x1b[0m"
}
const logLevels = [
  {level: "debug", color: "fgCyan"},
  {level: "info", color: "fgYellow"},
  {level: "error", color: "fgRed"}
  //,{level: "highlight", color: "fgMagenta"}
];

const printLog = (level, ...msgs) => {
  const logInfo = (level) => {
    const rank = R.findIndex(R.compose(R.equals(level), l => l.level), logLevels);
    return {rank, level, color: nodeColors[logLevels[rank].color]};
  };
  const li = logInfo(level);
  if (li.rank >= logInfo(logThreshold).rank) {
    const reset = nodeColors["reset"];
    const maxLength = R.reduce((cur, ll) => R.max(cur, ll.level.length), 0, logLevels)
    const logLevelDisplay = li.level.toUpperCase().padEnd(maxLength);
    const prefix = `[${now()}] [${logLevelDisplay}] `;
    console.log(`${li.color}${prefix}${msgs[0]}${reset}`);
    for (let i = 1; i < msgs.length; i++)
      console.log(`${li.color}${' '.repeat(prefix.length)}${msgs[i]}${reset}`);
  }
};

const log = {};
for (let {level} of logLevels)
  log[level] = (...msgs) => printLog(level, ...msgs);

module.exports = {
  log,
  setThreshold: (threshold) => { logThreshold = threshold; },
  logLevels: logLevels.map(l => l.level)
};
