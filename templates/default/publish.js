/* global env: true */
'use strict';

const powerConfiguratorHelper = require('../../helpers/power-configurator.helper').loadFromEnv();
const powerTemplateHelper = require('../../helpers/power-template.helper');

const jsdocDoop = require('jsdoc/util/doop');
const jsdocFS = require('jsdoc/fs');
const jsdocTemplateHelper = require('jsdoc/util/templateHelper');
const jsdocLogger = require('jsdoc/util/logger');
const jsdocPath = require('jsdoc/path');
const jsdocTemplate = require('jsdoc/template');
const taffy = require('taffydb').taffy;
const util = require('util');

let data;
let view;
let outdir = jsdocPath.normalize(env.opts.destination);

function find(spec) {
  return jsdocTemplateHelper.find(data, spec);
}

function generate(type, title, docs, filename, resolveLinks) {
  resolveLinks = resolveLinks !== false;

  let docData = {
    type: type,
    title: title,
    docs: docs
  };

  let outpath = jsdocPath.join(outdir, filename);
  let html = view.render('container.tmpl', docData);

  if (resolveLinks) {
    html = jsdocTemplateHelper.resolveLinks(html); // turn {@link foo} into <a href="foodoc.html">foo</a>
  }
  jsdocFS.writeFileSync(outpath, html, 'utf8');
}

function generateSourceFiles(sourceFiles, encoding) {
  encoding = encoding || 'utf8';

  Object.keys(sourceFiles).forEach(file => {
    let source;

    // links are keyed to the shortened jsdocPath in each doclet's `meta.shortpath` property
    let sourceOutfile = jsdocTemplateHelper.getUniqueFilename(sourceFiles[file].shortened);
    jsdocTemplateHelper.registerLink(sourceFiles[file].shortened, sourceOutfile);

    try {
      source = {
        kind: 'source',
        code: jsdocTemplateHelper.htmlsafe(jsdocFS.readFileSync(sourceFiles[file].resolved, encoding))
      };
    } catch (e) {
      jsdocLogger.error('Error while generating source file %s: %s', file, e.message);
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
          symbol = jsdocDoop(symbol);
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

      if (!item.hasOwnProperty('longname')) {
        itemsNav += '<li>' + linktoFn('', item.name);
        itemsNav += '</li>';
      } else if (!itemsSeen.hasOwnProperty(item.longname)) {
        itemsNav += '<li>' + linktoFn(item.longname, item.name.replace(/^module:/, ''));

        if (powerConfiguratorHelper.shouldDisplayStaticMembers() && members.find(m => m.scope === 'static')) {
          itemsNav += "<ul class='members'>";

          members.forEach(member => {
            if (!member.scope === 'static') return;
            itemsNav += "<li data-type='member'>";
            itemsNav += powerTemplateHelper.linkto(member.longname, member.name);
            itemsNav += "</li>";
          });

          itemsNav += "</ul>";
        }

        if (methods.length) {
          itemsNav += "<ul class='methods'>";

          methods.forEach(method => {
            itemsNav += "<li data-type='method'>";
            itemsNav += powerTemplateHelper.linkto(method.longname, method.name);
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

  nav += buildMemberNav(members.classes, 'Classes', seen, powerTemplateHelper.linkto);
  nav += buildMemberNav(members.modules, 'Modules', {}, powerTemplateHelper.linkto);
  nav += buildMemberNav(members.externals, 'Externals', seen, powerTemplateHelper.linktoExternal);
  nav += buildMemberNav(members.events, 'Events', seen, powerTemplateHelper.linkto);
  nav += buildMemberNav(members.namespaces, 'Namespaces', seen, powerTemplateHelper.linkto);
  nav += buildMemberNav(members.mixins, 'Mixins', seen, powerTemplateHelper.linkto);
  nav += buildMemberNav(members.tutorials, 'Tutorials', seenTutorials, powerTemplateHelper.linktoTutorial);
  nav += buildMemberNav(members.interfaces, 'Interfaces', seen, powerTemplateHelper.linkto);

  if (members.globals.length) {
    let globalNav = '';

    members.globals.forEach(g => {
      if (g.kind !== 'typedef' && !seen.hasOwnProperty(g.longname)) {
        globalNav += '<li>' + powerTemplateHelper.linkto(g.longname, g.name) + '</li>';
      }
      seen[g.longname] = true;
    });

    if (!globalNav) {
      // turn the heading into a link so you can actually get to the global page
      nav += '<h3>' + powerTemplateHelper.linkto('global', 'Global') + '</h3>';
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

  data = taffyData;

  let conf = env.conf.templates || {};
  conf.default = conf.default || {};

  let templatePath = jsdocPath.normalize(opts.template);
  view = new jsdocTemplate.Template(jsdocPath.join(templatePath, 'tmpl'));

  // claim some special filenames in advance, so the All-Powerful Overseer of Filename Uniqueness
  // doesn't try to hand them out later
  let indexUrl = jsdocTemplateHelper.getUniqueFilename('index');
  // don't call registerLink() on this one! 'index' is also a valid longname

  let globalUrl = jsdocTemplateHelper.getUniqueFilename('global');
  jsdocTemplateHelper.registerLink('global', globalUrl);

  // set up templating
  view.layout = conf.default.layoutFile
    ? jsdocPath.getResourcePath(jsdocPath.dirname(conf.default.layoutFile), jsdocPath.basename(conf.default.layoutFile))
    : 'layout.tmpl';

  // set up tutorials for jsdocTemplateHelper
  jsdocTemplateHelper.setTutorials(tutorials);
  data = jsdocTemplateHelper.prune(data);

  powerConfiguratorHelper.shouldSort() && data.sort('longname, version, since');
  jsdocTemplateHelper.addEventListeners(data);

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
      doclet.see.forEach((seeItem, i) => doclet.see[i] = powerTemplateHelper.hashToLink(doclet, seeItem));
    }

    // build a list of source files
    let sourcePath;
    if (doclet.meta) {
      sourcePath = powerTemplateHelper.getPathFromDoclet(doclet);
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
    outdir = jsdocPath.join(outdir, packageInfo.name, (packageInfo.version || ''));
  }
  jsdocFS.mkPath(outdir);

  // copy the template's static files to outdir
  let fromDir = jsdocPath.join(templatePath, 'static');
  let staticFiles = jsdocFS.ls(fromDir, 3);

  staticFiles.forEach(fileName => {
    let toDir = jsdocFS.toDir(fileName.replace(fromDir, outdir));
    jsdocFS.mkPath(toDir);
    jsdocFS.copyFileSync(fileName, toDir);
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
        let sourcePath = jsdocFS.toDir(filePath);
        let toDir = jsdocFS.toDir(fileName.replace(sourcePath, outdir));
        jsdocFS.mkPath(toDir);
        jsdocFS.copyFileSync(fileName, toDir);
      });
    });
  }

  if (sourceFilePaths.length) {
    sourceFiles = powerTemplateHelper.shortenPaths(sourceFiles, jsdocPath.commonPrefix(sourceFilePaths));
  }
  data().each(doclet => {
    let url = jsdocTemplateHelper.createLink(doclet);
    jsdocTemplateHelper.registerLink(doclet.longname, url);

    // add a shortened version of the full jsdocPath
    let docletPath;
    if (doclet.meta) {
      docletPath = powerTemplateHelper.getPathFromDoclet(doclet);
      docletPath = sourceFiles[docletPath].shortened;
      if (docletPath) {
        doclet.meta.shortpath = docletPath;
      }
    }
  });

  data().each(doclet => {
    let url = jsdocTemplateHelper.longnameToUrl[doclet.longname];

    if (url.indexOf('#') > -1) {
      doclet.id = jsdocTemplateHelper.longnameToUrl[doclet.longname].split(/#/).pop();
    } else {
      doclet.id = doclet.name;
    }

    if (powerTemplateHelper.needsSignature(doclet)) {
      powerTemplateHelper.addSignatureParams(doclet);
      powerTemplateHelper.addSignatureReturns(doclet);
      powerTemplateHelper.addAttribs(doclet);
    }
  });

  // do this after the urls have all been generated
  data().each(doclet => {
    doclet.ancestors = powerTemplateHelper.getAncestorLinks(data, doclet);

    if (doclet.kind === 'member') {
      powerTemplateHelper.addSignatureTypes(doclet);
      powerTemplateHelper.addAttribs(doclet);
    }

    if (doclet.kind === 'constant') {
      powerTemplateHelper.addSignatureTypes(doclet);
      powerTemplateHelper.addAttribs(doclet);
      doclet.kind = 'member';
    }
  });

  let members = jsdocTemplateHelper.getMembers(data);
  members.tutorials = tutorials.children;

  // output pretty-printed source files by default
  let outputSourceFiles = !!(conf.default && conf.default.outputSourceFiles !== false);

  // add template helpers
  view.find = find;
  view.linkto = powerTemplateHelper.linkto;
  view.resolveAuthorLinks = jsdocTemplateHelper.resolveAuthorLinks;
  view.tutoriallink = powerTemplateHelper.tutoriallink;
  view.htmlsafe = jsdocTemplateHelper.htmlsafe;
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

  Object.keys(jsdocTemplateHelper.longnameToUrl).forEach(longname => {
    let myModules = jsdocTemplateHelper.find(modules, {longname: longname});
    if (myModules.length) {
      generate('Module', myModules[0].name, myModules, jsdocTemplateHelper.longnameToUrl[longname]);
    }

    let myClasses = jsdocTemplateHelper.find(classes, {longname: longname});
    if (myClasses.length) {
      generate('Class', myClasses[0].name, myClasses, jsdocTemplateHelper.longnameToUrl[longname]);
    }

    let myNamespaces = jsdocTemplateHelper.find(namespaces, {longname: longname});
    if (myNamespaces.length) {
      generate('Namespace', myNamespaces[0].name, myNamespaces, jsdocTemplateHelper.longnameToUrl[longname]);
    }

    let myMixins = jsdocTemplateHelper.find(mixins, {longname: longname});
    if (myMixins.length) {
      generate('Mixin', myMixins[0].name, myMixins, jsdocTemplateHelper.longnameToUrl[longname]);
    }

    let myExternals = jsdocTemplateHelper.find(externals, {longname: longname});
    if (myExternals.length) {
      generate('External', myExternals[0].name, myExternals, jsdocTemplateHelper.longnameToUrl[longname]);
    }

    let myInterfaces = jsdocTemplateHelper.find(interfaces, {longname: longname});
    if (myInterfaces.length) {
      generate('Interface', myInterfaces[0].name, myInterfaces, jsdocTemplateHelper.longnameToUrl[longname]);
    }
  });

  // TODO: move the tutorial functions to jsdocTemplateHelper.js
  function generateTutorial(title, tutorial, filename) {
    let tutorialData = {
      title: title,
      header: tutorial.title,
      content: tutorial.parse(),
      children: tutorial.children
    };

    let tutorialPath = jsdocPath.join(outdir, filename);
    let html = view.render('tutorial.tmpl', tutorialData);

    // yes, you can use {@link} in tutorials too!
    html = jsdocTemplateHelper.resolveLinks(html); // turn {@link foo} into <a href="foodoc.html">foo</a>
    jsdocFS.writeFileSync(tutorialPath, html, 'utf8');
  }

  // tutorials can have only one parent so there is no risk for loops
  function saveChildren(node) {
    node.children.forEach(child => {
      generateTutorial('Tutorial: ' + child.title, child, jsdocTemplateHelper.tutorialToUrl(child.name));
      saveChildren(child);
    });
  }

  saveChildren(tutorials);
};
