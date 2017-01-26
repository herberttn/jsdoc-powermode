/* global env: true */
'use strict';

const doop = require('jsdoc/util/doop');
const fs = require('jsdoc/fs');
const templateHelper = require('jsdoc/util/templateHelper');
const logger = require('jsdoc/util/logger');
const path = require('jsdoc/path');
const taffy = require('taffydb').taffy;
const template = require('jsdoc/template');
const util = require('util');

let data;
let view;
let outdir = path.normalize(env.opts.destination);

function find(spec) {
  return templateHelper.find(data, spec);
}

function tutoriallink(tutorial) {
  return templateHelper.toTutorial(tutorial, null, {
    tag: 'em',
    classname: 'disabled',
    prefix: 'Tutorial: '
  });
}

function getAncestorLinks(doclet) {
  return templateHelper.getAncestorLinks(data, doclet);
}

function hashToLink(doclet, hash) {
  if (!/^(#.+)/.test(hash)) {
    return hash;
  }

  let url = templateHelper.createLink(doclet);
  url = url.replace(/(#.+|$)/, hash);
  return '<a href="' + url + '">' + hash + '</a>';
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

function addParamAttributes(params) {
  return params
    .filter(param => param.name && param.name.indexOf('.') === -1)
    .map(updateItemName);
}

function buildItemTypeStrings(item) {
  let types = [];

  if (item && item.type && item.type.names) {
    item.type.names.forEach(name => types.push(templateHelper.linkto(name, templateHelper.htmlsafe(name))));
  }
  return types;
}

function buildAttribsString(attribs) {
  let attribsString = '';

  if (attribs && attribs.length) {
    attribsString = templateHelper.htmlsafe(util.format('(%s) ', attribs.join(', ')));
  }
  return attribsString;
}

function addNonParamAttributes(items) {
  let types = [];

  if (items && items.length) {
    items.forEach(item => types = types.concat(buildItemTypeStrings(item)));
  }
  return types;
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
      templateHelper.getAttribs(item).forEach(attrib => {
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

function addAttribs(f) {
  let attribs = templateHelper.getAttribs(f);
  let attribsString = buildAttribsString(attribs);
  f.attribs = util.format('<span class="type-signature">%s</span>', attribsString);
}

function shortenPaths(files, commonPrefix) {
  Object.keys(files).forEach(file => {
    files[file].shortened = files[file].resolved.replace(commonPrefix, '').replace(/\\/g, '/'); // always use forward slashes
  });
  return files;
}

function getPathFromDoclet(doclet) {
  if (!doclet.meta) {
    return null;
  }

  return doclet.meta.path && doclet.meta.path !== 'null'
    ? path.join(doclet.meta.path, doclet.meta.filename)
    : doclet.meta.filename;
}

function generate(type, title, docs, filename, resolveLinks) {
  resolveLinks = resolveLinks !== false;

  let docData = {
    type: type,
    title: title,
    docs: docs
  };

  let outpath = path.join(outdir, filename);
  let html = view.render('container.tmpl', docData);

  if (resolveLinks) {
    html = templateHelper.resolveLinks(html); // turn {@link foo} into <a href="foodoc.html">foo</a>
  }
  fs.writeFileSync(outpath, html, 'utf8');
}

function generateSourceFiles(sourceFiles, encoding) {
  encoding = encoding || 'utf8';

  Object.keys(sourceFiles).forEach(file => {
    let source;

    // links are keyed to the shortened path in each doclet's `meta.shortpath` property
    let sourceOutfile = templateHelper.getUniqueFilename(sourceFiles[file].shortened);
    templateHelper.registerLink(sourceFiles[file].shortened, sourceOutfile);

    try {
      source = {
        kind: 'source',
        code: templateHelper.htmlsafe(fs.readFileSync(sourceFiles[file].resolved, encoding))
      };
    } catch (e) {
      logger.error('Error while generating source file %s: %s', file, e.message);
    }

    generate('Source', sourceFiles[file].shortened, [source], sourceOutfile, false);
  });
}

/**
 * Look for classes or functions with the same name as modules (which indicates that the module
 * exports only that class or function), then attach the classes or functions to the `module`
 * property of the appropriate module doclets. The name of each class or function is also updated
 * for display purposes. This function mutates the original arrays.
 *
 * @private
 * @param {Array.<module:jsdoc/doclet.Doclet>} doclets - The array of classes and functions to check.
 * @param {Array.<module:jsdoc/doclet.Doclet>} modules - The array of module doclets to search.
 */
function attachModuleSymbols(doclets, modules) {
  let symbols = {};

  // build a lookup table
  doclets.forEach(symbol => {
    symbols[symbol.longname] = symbols[symbol.longname] || [];
    symbols[symbol.longname].push(symbol);
  });

  return modules.map(module => {
    if (symbols[module.longname]) {
      // Only show symbols that have a description. Make an exception for classes, because
      // we want to show the constructor-signature heading no matter what.
      module.modules = symbols[module.longname]
        .filter(symbol => symbol.description || symbol.kind === 'class')
        .map(symbol => {
          symbol = doop(symbol);
          if (symbol.kind === 'class' || symbol.kind === 'function') {
            symbol.name = symbol.name.replace('module:', '(require("') + '"))';
          }
          return symbol;
        });
    }
  });
}

function buildMemberNav(items, itemHeading, itemsSeen, linktoFn) {
  let nav = '';

  if (items && items.length) {
    let itemsNav = '';

    items.forEach(function (item) {
      let methods = find({kind: 'function', memberof: item.longname});
      let members = find({kind: 'member', memberof: item.longname});
      let docdash = env && env.conf && env.conf.docdash || {};

      if (!item.hasOwnProperty('longname')) {
        itemsNav += '<li>' + linktoFn('', item.name);
        itemsNav += '</li>';
      } else if (!itemsSeen.hasOwnProperty(item.longname)) {
        itemsNav += '<li>' + linktoFn(item.longname, item.name.replace(/^module:/, ''));

        if (docdash.static && members.find(m => m.scope === 'static')) {
          itemsNav += "<ul class='members'>";

          members.forEach(member => {
            if (!member.scope === 'static') return;
            itemsNav += "<li data-type='member'>";
            itemsNav += templateHelper.linkto(member.longname, member.name);
            itemsNav += "</li>";
          });

          itemsNav += "</ul>";
        }

        if (methods.length) {
          itemsNav += "<ul class='methods'>";

          methods.forEach(method => {
            itemsNav += "<li data-type='method'>";
            itemsNav += templateHelper.linkto(method.longname, method.name);
            itemsNav += "</li>";
          });

          itemsNav += "</ul>";
        }

        itemsNav += '</li>';
        itemsSeen[item.longname] = true;
      }
    });

    if (itemsNav !== '') {
      nav += '<h3>' + itemHeading + '</h3><ul>' + itemsNav + '</ul>';
    }
  }

  return nav;
}

function linktoTutorial(longName, name) {
  return tutoriallink(name);
}

function linktoExternal(longName, name) {
  return templateHelper.linkto(longName, name.replace(/(^"|"$)/g, ''));
}

/**
 * Create the navigation sidebar.
 * @param {object} members The members that will be used to create the sidebar.
 * @param {array<object>} members.classes
 * @param {array<object>} members.externals
 * @param {array<object>} members.globals
 * @param {array<object>} members.mixins
 * @param {array<object>} members.modules
 * @param {array<object>} members.namespaces
 * @param {array<object>} members.tutorials
 * @param {array<object>} members.events
 * @param {array<object>} members.interfaces
 * @return {string} The HTML for the navigation sidebar.
 */
function buildNav(members) {
  let nav = '<h2><a href="index.html">Home</a></h2>';
  let seen = {};
  let seenTutorials = {};

  nav += buildMemberNav(members.classes, 'Classes', seen, templateHelper.linkto);
  nav += buildMemberNav(members.modules, 'Modules', {}, templateHelper.linkto);
  nav += buildMemberNav(members.externals, 'Externals', seen, linktoExternal);
  nav += buildMemberNav(members.events, 'Events', seen, templateHelper.linkto);
  nav += buildMemberNav(members.namespaces, 'Namespaces', seen, templateHelper.linkto);
  nav += buildMemberNav(members.mixins, 'Mixins', seen, templateHelper.linkto);
  nav += buildMemberNav(members.tutorials, 'Tutorials', seenTutorials, linktoTutorial);
  nav += buildMemberNav(members.interfaces, 'Interfaces', seen, templateHelper.linkto);

  if (members.globals.length) {
    let globalNav = '';

    members.globals.forEach(g => {
      if (g.kind !== 'typedef' && !seen.hasOwnProperty(g.longname)) {
        globalNav += '<li>' + templateHelper.linkto(g.longname, g.name) + '</li>';
      }
      seen[g.longname] = true;
    });

    if (!globalNav) {
      // turn the heading into a link so you can actually get to the global page
      nav += '<h3>' + templateHelper.linkto('global', 'Global') + '</h3>';
    } else {
      nav += '<h3>Global</h3><ul>' + globalNav + '</ul>';
    }
  }

  return nav;
}

/**
 @param {TAFFY} taffyData See <http://taffydb.com/>.
 @param {object} opts
 @param {Tutorial} tutorials
 */
exports.publish = (taffyData, opts, tutorials) => {
  let docdash = env && env.conf && env.conf.docdash || {};
  data = taffyData;

  let conf = env.conf.templates || {};
  conf.default = conf.default || {};

  let templatePath = path.normalize(opts.template);
  view = new template.Template(path.join(templatePath, 'tmpl'));

  // claim some special filenames in advance, so the All-Powerful Overseer of Filename Uniqueness
  // doesn't try to hand them out later
  let indexUrl = templateHelper.getUniqueFilename('index');
  // don't call registerLink() on this one! 'index' is also a valid longname

  let globalUrl = templateHelper.getUniqueFilename('global');
  templateHelper.registerLink('global', globalUrl);

  // set up templating
  view.layout = conf.default.layoutFile
    ? path.getResourcePath(path.dirname(conf.default.layoutFile), path.basename(conf.default.layoutFile))
    : 'layout.tmpl';

  // set up tutorials for templateHelper
  templateHelper.setTutorials(tutorials);
  data = templateHelper.prune(data);

  docdash.sort !== false && data.sort('longname, version, since');
  templateHelper.addEventListeners(data);

  let sourceFiles = {};
  let sourceFilePaths = [];
  data().each(doclet => {
    doclet.attribs = '';

    if (doclet.examples) {
      doclet.examples = doclet.examples.map(example => {
        let caption, code;

        if (example.match(/^\s*<caption>([\s\S]+?)<\/caption>(\s*[\n\r])([\s\S]+)$/i)) {
          caption = RegExp.$1;
          code = RegExp.$3;
        }

        return {
          caption: caption || '',
          code: code || example
        };
      });
    }

    if (doclet.see) {
      doclet.see.forEach((seeItem, i) => doclet.see[i] = hashToLink(doclet, seeItem));
    }

    // build a list of source files
    let sourcePath;
    if (doclet.meta) {
      sourcePath = getPathFromDoclet(doclet);
      sourceFiles[sourcePath] = {
        resolved: sourcePath,
        shortened: null
      };
      if (sourceFilePaths.indexOf(sourcePath) === -1) {
        sourceFilePaths.push(sourcePath);
      }
    }
  });

  // update outdir if necessary, then create outdir
  let packageInfo = (find({kind: 'package'}) || [])[0];
  if (packageInfo && packageInfo.name) {
    outdir = path.join(outdir, packageInfo.name, (packageInfo.version || ''));
  }
  fs.mkPath(outdir);

  // copy the template's static files to outdir
  let fromDir = path.join(templatePath, 'static');
  let staticFiles = fs.ls(fromDir, 3);

  staticFiles.forEach(fileName => {
    let toDir = fs.toDir(fileName.replace(fromDir, outdir));
    fs.mkPath(toDir);
    fs.copyFileSync(fileName, toDir);
  });

  // copy user-specified static files to outdir
  let staticFilePaths;
  let staticFileFilter;
  let staticFileScanner;
  if (conf.default.staticFiles) {
    // The canonical property name is `include`. We accept `paths` for backwards compatibility
    // with a bug in JSDoc 3.2.x.
    staticFilePaths = conf.default.staticFiles.include ||
      conf.default.staticFiles.paths ||
      [];
    staticFileFilter = new (require('jsdoc/src/filter')).Filter(conf.default.staticFiles);
    staticFileScanner = new (require('jsdoc/src/scanner')).Scanner();

    staticFilePaths.forEach(filePath => {
      let extraStaticFiles = staticFileScanner.scan([filePath], 10, staticFileFilter);

      extraStaticFiles.forEach(fileName => {
        let sourcePath = fs.toDir(filePath);
        let toDir = fs.toDir(fileName.replace(sourcePath, outdir));
        fs.mkPath(toDir);
        fs.copyFileSync(fileName, toDir);
      });
    });
  }

  if (sourceFilePaths.length) {
    sourceFiles = shortenPaths(sourceFiles, path.commonPrefix(sourceFilePaths));
  }
  data().each(doclet => {
    let url = templateHelper.createLink(doclet);
    templateHelper.registerLink(doclet.longname, url);

    // add a shortened version of the full path
    let docletPath;
    if (doclet.meta) {
      docletPath = getPathFromDoclet(doclet);
      docletPath = sourceFiles[docletPath].shortened;
      if (docletPath) {
        doclet.meta.shortpath = docletPath;
      }
    }
  });

  data().each(doclet => {
    let url = templateHelper.longnameToUrl[doclet.longname];

    if (url.indexOf('#') > -1) {
      doclet.id = templateHelper.longnameToUrl[doclet.longname].split(/#/).pop();
    } else {
      doclet.id = doclet.name;
    }

    if (needsSignature(doclet)) {
      addSignatureParams(doclet);
      addSignatureReturns(doclet);
      addAttribs(doclet);
    }
  });

  // do this after the urls have all been generated
  data().each(doclet => {
    doclet.ancestors = getAncestorLinks(doclet);

    if (doclet.kind === 'member') {
      addSignatureTypes(doclet);
      addAttribs(doclet);
    }

    if (doclet.kind === 'constant') {
      addSignatureTypes(doclet);
      addAttribs(doclet);
      doclet.kind = 'member';
    }
  });

  let members = templateHelper.getMembers(data);
  members.tutorials = tutorials.children;

  // output pretty-printed source files by default
  let outputSourceFiles = !!(conf.default && conf.default.outputSourceFiles !== false);

  // add template helpers
  view.find = find;
  view.linkto = templateHelper.linkto;
  view.resolveAuthorLinks = templateHelper.resolveAuthorLinks;
  view.tutoriallink = tutoriallink;
  view.htmlsafe = templateHelper.htmlsafe;
  view.outputSourceFiles = outputSourceFiles;

  // once for all
  view.nav = buildNav(members);
  attachModuleSymbols(find({longname: {left: 'module:'}}), members.modules);

  // generate the pretty-printed source files first so other pages can link to them
  if (outputSourceFiles) {
    generateSourceFiles(sourceFiles, opts.encoding);
  }

  if (members.globals.length) {
    generate('', 'Global', [{kind: 'globalobj'}], globalUrl);
  }

  // index page displays information from package.json and lists files
  let files = find({kind: 'file'});
  let packages = find({kind: 'package'});

  generate('', 'Home', packages.concat([{
    kind: 'mainpage',
    readme: opts.readme,
    longname: (opts.mainpagetitle) ? opts.mainpagetitle : 'Main Page'
  }]).concat(files), indexUrl);

  // set up the lists that we'll use to generate pages
  let classes = taffy(members.classes);
  let modules = taffy(members.modules);
  let namespaces = taffy(members.namespaces);
  let mixins = taffy(members.mixins);
  let externals = taffy(members.externals);
  let interfaces = taffy(members.interfaces);

  Object.keys(templateHelper.longnameToUrl).forEach(longname => {
    let myModules = templateHelper.find(modules, {longname: longname});
    if (myModules.length) {
      generate('Module', myModules[0].name, myModules, templateHelper.longnameToUrl[longname]);
    }

    let myClasses = templateHelper.find(classes, {longname: longname});
    if (myClasses.length) {
      generate('Class', myClasses[0].name, myClasses, templateHelper.longnameToUrl[longname]);
    }

    let myNamespaces = templateHelper.find(namespaces, {longname: longname});
    if (myNamespaces.length) {
      generate('Namespace', myNamespaces[0].name, myNamespaces, templateHelper.longnameToUrl[longname]);
    }

    let myMixins = templateHelper.find(mixins, {longname: longname});
    if (myMixins.length) {
      generate('Mixin', myMixins[0].name, myMixins, templateHelper.longnameToUrl[longname]);
    }

    let myExternals = templateHelper.find(externals, {longname: longname});
    if (myExternals.length) {
      generate('External', myExternals[0].name, myExternals, templateHelper.longnameToUrl[longname]);
    }

    let myInterfaces = templateHelper.find(interfaces, {longname: longname});
    if (myInterfaces.length) {
      generate('Interface', myInterfaces[0].name, myInterfaces, templateHelper.longnameToUrl[longname]);
    }
  });

  // TODO: move the tutorial functions to templateHelper.js
  function generateTutorial(title, tutorial, filename) {
    let tutorialData = {
      title: title,
      header: tutorial.title,
      content: tutorial.parse(),
      children: tutorial.children
    };

    let tutorialPath = path.join(outdir, filename);
    let html = view.render('tutorial.tmpl', tutorialData);

    // yes, you can use {@link} in tutorials too!
    html = templateHelper.resolveLinks(html); // turn {@link foo} into <a href="foodoc.html">foo</a>
    fs.writeFileSync(tutorialPath, html, 'utf8');
  }

  // tutorials can have only one parent so there is no risk for loops
  function saveChildren(node) {
    node.children.forEach(child => {
      generateTutorial('Tutorial: ' + child.title, child, templateHelper.tutorialToUrl(child.name));
      saveChildren(child);
    });
  }

  saveChildren(tutorials);
};
