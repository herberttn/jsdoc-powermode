const jsdocTemplateHelper = require('jsdoc/util/templateHelper');
const jsdocPathHelper = require('jsdoc/path');
const util = require('util');

module.exports = {
  addAttribs,
  addNonParamAttributes,
  addParamAttributes,
  addSignatureParams,
  addSignatureReturns,
  addSignatureTypes,
  buildAttribsString,
  buildItemTypeStrings,
  getAncestorLinks,
  getPathFromDoclet,
  getSignatureAttributes,
  hashToLink,
  linkto,
  linktoExternal,
  linktoTutorial,
  needsSignature,
  shortenPaths,
  tutoriallink,
  updateItemName
};

function addAttribs(f) {
  let attribs = jsdocTemplateHelper.getAttribs(f);
  let attribsString = buildAttribsString(attribs);
  f.attribs = util.format('<span class="type-signature">%s</span>', attribsString);
}

function addNonParamAttributes(items) {
  let types = [];
  if (items && items.length) {
    items.forEach(item => types = types.concat(buildItemTypeStrings(item)));
  }
  return types;
}

function addParamAttributes(params) {
  return params
    .filter(param => param.name && param.name.indexOf('.') === -1)
    .map(updateItemName);
}

function addSignatureParams(f) {
  let params = f.params ? addParamAttributes(f.params) : [];
  f.signature = util.format('%s(%s)', (f.signature || ''), params.join(', '));
}

function addSignatureReturns(f) {
  let attribs = [];
  let attribsString = '';
  let returnTypes = [];
  let returnTypesString = '';

  // jam all the return-type attributes into an array. this could create odd results (for example,
  // if there are both nullable and non-nullable return types), but let's assume that most people
  // who use multiple @return tags aren't using Closure Compiler type annotations, and vice-versa.
  if (f.returns) {
    f.returns.forEach(item => {
      jsdocTemplateHelper.getAttribs(item).forEach(attrib => {
        if (attribs.indexOf(attrib) === -1) {
          attribs.push(attrib);
        }
      });
    });
    attribsString = buildAttribsString(attribs);
  }

  if (f.returns) {
    returnTypes = addNonParamAttributes(f.returns);
  }

  if (returnTypes.length) {
    returnTypesString = util.format(' &rarr; %s{%s}', attribsString, returnTypes.join('|'));
  }

  f.signature =
    '<span class="signature">' + (f.signature || '') + '</span>' +
    '<span class="type-signature">' + returnTypesString + '</span>';
}

function addSignatureTypes(f) {
  let types = f.type ? buildItemTypeStrings(f) : [];

  f.signature = (f.signature || '') +
    '<span class="type-signature">' + (types.length ? ' :' + types.join('|') : '') + '</span>';
}

function buildAttribsString(attribs) {
  let attribsString = '';
  if (attribs && attribs.length) {
    attribsString = jsdocTemplateHelper.htmlsafe(util.format('(%s) ', attribs.join(', ')));
  }
  return attribsString;
}

function buildItemTypeStrings(item) {
  let types = [];
  if (item && item.type && item.type.names) {
    item.type.names.forEach(name => types.push(linkto(name, jsdocTemplateHelper.htmlsafe(name))));
  }
  return types;
}

function getAncestorLinks(data, doclet) {
  return jsdocTemplateHelper.getAncestorLinks(data, doclet);
}

function getPathFromDoclet(doclet) {
  if (!doclet.meta) {
    return null;
  }
  return doclet.meta.path && doclet.meta.path !== 'null'
    ? jsdocPathHelper.join(doclet.meta.path, doclet.meta.filename)
    : doclet.meta.filename;
}

function getSignatureAttributes(item) {
  let attributes = [];

  if (item.optional) {
    attributes.push('opt');
  }

  if (item.nullable === true) {
    attributes.push('nullable');
  } else if (item.nullable === false) {
    attributes.push('non-null');
  }
  return attributes;
}

function hashToLink(doclet, hash) {
  if (!/^(#.+)/.test(hash)) {
    return hash;
  }

  let url = jsdocTemplateHelper.createLink(doclet);
  url = url.replace(/(#.+|$)/, hash);
  return '<a href="' + url + '">' + hash + '</a>';
}

function linkto(longName, name) {
  return jsdocTemplateHelper.linkto(longName, name);
}

function linktoExternal(longName, name) {
  return jsdocTemplateHelper.linkto(longName, name.replace(/(^"|"$)/g, ''));
}

function linktoTutorial(longName, name) {
  return tutoriallink(name);
}

function needsSignature(doclet) {
  let needsSig = false;

  // function and class definitions always get a signature
  if (doclet.kind === 'function' || doclet.kind === 'class') {
    needsSig = true;
  }
  // typedefs that contain functions get a signature, too
  else if (doclet.kind === 'typedef' && doclet.type && doclet.type.names && doclet.type.names.length) {
    for (let i = 0, l = doclet.type.names.length; i < l; i++) {
      if (doclet.type.names[i].toLowerCase() === 'function') {
        needsSig = true;
        break;
      }
    }
  }
  return needsSig;
}

function shortenPaths(files, commonPrefix) {
  Object.keys(files).forEach(file => {
    files[file].shortened = files[file].resolved.replace(commonPrefix, '').replace(/\\/g, '/'); // always use forward slashes
  });
  return files;
}

function tutoriallink(tutorial) {
  return jsdocTemplateHelper.toTutorial(tutorial, null, {
    tag: 'em',
    classname: 'disabled',
    prefix: 'Tutorial: '
  });
}

function updateItemName(item) {
  let attributes = getSignatureAttributes(item);
  let itemName = item.name || '';

  if (item.variable) {
    itemName = '&hellip;' + itemName;
  }

  if (attributes && attributes.length) {
    itemName = util.format('%s<span class="signature-attributes">%s</span>', itemName, attributes.join(', '));
  }
  return itemName;
}
