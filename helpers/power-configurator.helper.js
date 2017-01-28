/* global env: true */

module.exports = {
  parse,
  loadFromEnv
};

function loadFromEnv() {
  console.log('');
  console.log('config =', env.conf);
  console.log('');

  if (env && env.conf && env.conf.powerMode) {
    return parse(env.conf.powerMode);
  }
}

function parse(object) {
  let config = object || {};

  const defaults = {
    displayStaticMembers: false,
    sort: true
  };

  return {
    shouldDisplayStaticMembers: () => trueOrNotWithDefault(config.displayStaticMembers, defaults.displayStaticMembers),
    shouldSort                : () => trueOrNotWithDefault(config.sort, defaults.sort)
  };

  function trueOrNotWithDefault(value, defaultValue) {
    return (value === true || value === false) ? value : defaultValue;
  }
}
