const { fileSync } = require('tmp');
const { writeSync } = require('fs');
const { getInput, setOutput } = require('./util/io');

function writeTemp(file, ext = '.json') {
  const tmp = fileSync({ postfix: ext });

  writeSync(tmp.fd, file);

  return tmp.name;
}

module.exports = () => {
  setOutput('file', writeTemp(getInput('CONTENT'), getInput('EXT')));
};

module.exports.writeTemp = writeTemp;
