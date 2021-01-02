const { fileSync } = require('tmp');
const { writeSync } = require('fs');
const { getInput, setOutput } = require('./util/io');

module.exports = () => {
  const tmp = fileSync({ postfix: getInput('EXT') || '.json' });

  writeSync(tmp.fd, getInput('CONTENT'));

  setOutput('file', tmp.name);
};
