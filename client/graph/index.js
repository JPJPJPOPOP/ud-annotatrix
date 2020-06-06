"use strict";

const _ = require("underscore");
const $ = require("jquery");
const config = require("./config");
const cytoscape = require("./cytoscape/cytoscape.min");
const nx = require("notatrix");
const sort = require("./sort");
const utils = require("../utils");
const zoom = require("./zoom");

/**
 * Abstraction over the cytoscape canvas.  Handles interaction between the graph
 *  and the user.  For example, all the event handlers are here, the methods that
 *  draw the graph, and the methods that place the mice / locks.
 *
 * @param {App} app a reference to the parent of this module
 */
class Graph {
  constructor(app) {
    console.log("CONFIG:", config);
    // save refs
    this.app = app;
    this.config = config;

    // pull this complexity out into its own module
    this.zoom = zoom;

    // keep track for our progress bar
    this.progress = {
      done: 0,
      total: 0,
    };

    // GUI-state stuff
    this.intercepted = false;
    this.editing = null;
    this.moving_dependency = null;

    // total number of elements in the graph
    this.length = 0;

    // number of "clumps" in the graph (i.e. form-node, pos-node, pos-edge, and
    //  number-node all form a single "clump"). the clump determines the horiz
    //  positioning of the cytoscape eles
    this.clumps = 0;

    // selector for our currently locked node/edge
    this.locked = null;

    // timer to enforce our mouse-move broadcast min-interval
    this.mouseBlocked = false;

    // Stores the token objects corresponding to each form.
    // We need to do this rather than just storing the token
    // objects in the html object using .data() because
    // apparently, if we set the data in visualiser.js,
    // we won't be able to fetch it in here. So this is the
    // only way really.
    this.tokens = {};

    // load configuration prefs
    this.load();
  }

  // ---------------------------------------------------------------------------
  // core functionality

  /**
   * Build a list of cytoscape elements, both nodes and edges.  This function
   *  also validates all the elements.
   *
   * @return {Array} [{ data: Object, classes: String }]
   */
  get eles() {

    // helper function to get subscripted index numbers for superTokens
    function toSubscript(str) {
      const subscripts = {
        0: "₀",
        1: "₁",
        2: "₂",
        3: "₃",
        4: "₄",
        5: "₅",
        6: "₆",
        7: "₇",
        8: "₈",
        9: "₉",
        "-": "₋",
        "(": "₍",
        ")": "₎"
      };

      if (str == "null")
        return "";

      return str.split("").map((char) => { return (subscripts[char] || char); }).join("");
    }

    // helper function to get index numbers for a particular format
    function getIndex(token, format) {
      return format === "CoNLL-U" ? token.indices.conllu
                                  : format === "CG3" ? token.indices.cg3 : token.indices.absolute;
    }

    // reset our progress tracker
    this.progress.done = 0;
    this.progress.total = 0;

    // cache these
    const sent = this.app.corpus.current, format = this.app.corpus.format;

    // num is like clump except not including superTokens, eles in the list
    let num = 0, eles = [];

    // walk over all the tokens
    sent.index().iterate(token => {
      // don't draw other analyses
      if (token.indices.cytoscape == null && !token.isSuperToken)
        return;

      // cache some values
      let id = getIndex(token, format);
      let clump = token.indices.cytoscape;
      let pos = format === "CG3" ? token.xpostag || token.upostag : token.upostag || token.xpostag;
      let isRoot = sent.root.dependents.has(token);

      // after iteration, this will just be the max
      this.clumps = clump;

      if (token.isSuperToken) {

        eles.push({
          // multiword label
          data: {
            id: `multiword-${id}`,
            clump: clump,
            name: `multiword`,
            label: `${token.form} ${toSubscript(`${id}`)}`,
            length: `${token.form.length > 3 ? token.form.length * 0.7 : token.form.length}em`,
            token: token,
          },
          classes: "multiword"
        });

      } else {

        this.progress.total += 2;
        if (pos && pos !== "_")
          this.progress.done += 1;
        if (token.heads.length)
          this.progress.done += 1;

        let parent = token.name === "SubToken" ? "multiword-" + getIndex(sent.getSuperToken(token), format) : undefined;

        this.tokens[id] = token;

        eles.push(
          { // "form" node
            id: `form-${id}`,
            num: ++num,
            clump: clump,
            name: 'form',
            attr: 'form',
            form: token.form,
            label: token.form || '_',
            type: parent ? 'subToken' : 'token',
            state: `normal`,
            parent: `num-${id}`,
            token: token,
            classes: isRoot ? 'form root' : 'form',
            posClasses: utils.validate.posNodeClasses(pos),
            posAttr: format === 'CG3' ? `xpostag` : `upostag`,
            posLabel: pos || '',
          },
        );

        // iterate over the token's heads to get edges
        token.mapHeads((head, i) => {
          // if not enhanced, only draw the first dependency
          if (i && !sent.options.enhanced)
            return;

          this.progress.total += 1;
          if (head.deprel && head.deprel !== "_")
            this.progress.done += 1;

          // roots don't get edges drawn (just bolded)
          if (head.token.name === "RootToken")
            return;

          let deprel = head.deprel || "";

          const id = getIndex(token, format), headId = getIndex(head.token, format),
                label = this.app.corpus.is_ltr
                            ? token.indices.absolute > head.token.indices.absolute ? `${deprel}⊳` : `⊲${deprel}`
                            : token.indices.absolute > head.token.indices.absolute ? `⊲${deprel}` : `${deprel}⊳`;


          eles.push({
            id: `dep_${id}_${headId}`,
            name: `dependency`,
            num: ++num,
            attr: `deprel`,
            deprel: deprel,
            source: `token-${headId}`,
            sourceNum: parseInt(headId),
            sourceToken: head.token,
            target: `token-${id}`,
            targetNum: parseInt(id),
            targetToken: token,
            label: label,
            enhanced: i ? true: false,
            classes: utils.validate.depEdgeClasses(sent, token, head),
          });
        });
      }
    });

    this.length = num;
    return eles;
  }

  /**
   * Create the cytoscape instance and populate it with the nodes and edges we
   * generate in `this.eles`.
   *
   * @return {Graph} (chaining)
   */
  draw() {
    // cache a ref
    
    const corpus = this.app.corpus;
    v.bind(this);
    v.run();
    console.log(this.tokens);

    // add the mice and locks from `collab`
    //this.drawMice();
    //this.setLocks();

    // check if we had something locked already before we redrew the graph
    if (config.locked_index === this.app.corpus.index) {

      // add the class to the element
      const locked = $("#" + config.locked_id);
      locked.addClass(config.locked_classes);

      /*if (config.locked_classes.indexOf("merge-source") > -1) {

        // add the classes to adjacent elements if we were merging

        const left = this.getPrevForm();
        if (left && !left.hasClass("activated") && !left.hasClass("blocked") && left.data("type") === "token")
          left.addClass("neighbor merge-left");

        const right = this.getNextForm();
        if (right && !right.hasClass("activated") && !right.hasClass("blocked") && right.data("type") === "token")
          right.addClass("neighbor merge-right");

      } else if (config.locked_classes.indexOf("combine-source") > -1) {

        // add the classes to the adjacent elements if we were combining

        const left = this.getPrevForm();
        if (left && !left.hasClass("activated") && !left.hasClass("blocked") && left.data("type") === "token")
          left.addClass("neighbor combine-left");

        const right = this.getNextForm();
        if (right && !right.hasClass("activated") && !right.hasClass("blocked") && right.data("type") === "token")
          right.addClass("neighbor combine-right");
      }*/

      // make sure we lock it in the same way as if we had just clicked it
      this.lock(locked);
    }
    // set event handler callbacks
    return this.bind();
  }

  /**
   * Bind event handlers to the cytoscape elements and the enclosing canvas.
   *
   * @return {Graph} (chaining)
   */
  bind() {

    // avoid problems w/ `this`-rebinding in callbacks
    const self = this;

    // Triggering a "background" click unless a node/edge intercepts it
    // Note: this triggers after everything else. Also, we call unbind
    // because event handlers would otherwise stack on #mute.
    $('#graph-svg, #mute').unbind().on('click contextmenu', function(e) {
      console.log(e.target);
      console.log("svg clicked", self.intercepted);
      self.save();
      self.clear();
      self.intercepted = false;
      e.preventDefault();
    });

    // don't clear if we clicked inside #edit
    $('#edit').click(function() {
      console.log("nooooo");
      self.intercepted = true;
    });

    $('#graph-svg').on('click contextmenu', '*', e => {
      self.intercepted = true;
    });

    // We can't use the event handler because if we click
    // on text, it gives us the text as the target, not
    // the rect which we want.
    $('.token').click(function() {
      self.intercepted = true;
      console.log("clicked on token");
      let targetNum = $(this).attr('id').replace(/\D/g,'');
      console.log(targetNum);
      // THIS is #group-[id]. But we want #form-[id].
      let target = $('#form-' + targetNum);
      if (target.hasClass('locked'))
        return;
      if (self.moving_dependency) {

        const dep = $('.selected');
        const sourceNum = $('.arc-source').attr('id').replace(/\D/g,'');;

        // make a new dep, remove the old one
        self.makeDependency(self.tokens[sourceNum], self.tokens[targetNum]);
        self.removeDependency(dep);
        $('.moving').removeClass('moving');
        self.moving_dependency = false;

        const newEdge = $('#dep_' + targetNum + '_' + sourceNum);
        console.log('#dep_' + targetNum + '_' + sourceNum);
        // right click the new edge and lock it
        newEdge.trigger('contextmenu');
        self.moving_dependency = true;
        self.lock(newEdge);

      } else {

        // check if there's anything in-progress
        self.commit();

        $('.arc-source').removeClass('arc-source');
        $('.arc-target').removeClass('arc-target');
        $('.selected').removeClass('selected');

        // handle the click differently based on current state

        if (target.hasClass('merge-right') || target.hasClass('merge-left')) {

          // perform merge
          //self.merge(self.cy.$('.merge-source').data('token'), target.data('token'));
          //self.unlock();

        } else if (target.hasClass('combine-right') || target.hasClass('combine-left')) {

          // perform combine
          //self.combine(self.cy.$('.combine-source').data('token'), target.data('token'));
          //self.unlock();

        } else if (target.hasClass('activated')) {

          // de-activate
          self.intercepted = false;
          self.clear();

        } else {

          let source = $('.activated');
          target.addClass('activated');

          // if there was already an activated node
          if (source.length === 1) {
            // add a new edge
            let sourceNum = source.attr('id').replace(/\D/g,'');
            self.makeDependency(self.tokens[sourceNum], self.tokens[targetNum]);
            source.removeClass('activated');
            target.removeClass('activated');
            self.unlock();

          } else {

            // activate it
            self.lock(target);

          }
        }
      }
    });

    /*this.cy.on("mousemove", e => {
      // send out a 'move mouse' event at most every `mouse_move_delay` msecs
      if (self.app.initialized && !self.mouseBlocked && self.app.online)
        self.app.socket.broadcast("move mouse", e.position);

      // enforce the delay
      self.mouseBlocked = true;
      setTimeout(() => { self.mouseBlocked = false; }, config.mouse_move_delay);

    });*/

    $(".pos, .pos-label").on('click', function() {
      self.intercepted = true;
      console.log("clicked on deprel, editing now");
      // If we click on the text, we want to convert it to the deprel id
      let targetId = $(this).attr('id').replace('text-','');

      const target = $('#' + targetId);

      if (target.hasClass("locked"))
        return;

      self.commit();
      self.editing = target;

      $(".activated").removeClass("activated");
      $(".arc-source").removeClass("arc-source");
      $(".arc-target").removeClass("arc-target");
      $(".selected").removeClass("selected");

      self.showEditLabelBox(target);
      self.lock(target);
    });

    /*self.cy.on("click", "$node > node", e => {
      const target = e.target;

      if (target.hasClass("locked"))
        return;

      self.cy.$(".activated").removeClass("activated");

      if (target.hasClass("multiword-active")) {

        target.removeClass("multiword-active");
        self.unlock();

      } else {

        self.cy.$(".multiword-active").removeClass("multiword-active");
        target.addClass("multiword-active");
        self.lock(target);
      }
    });

    self.cy.on('cxttapend', 'node.form', e => {

      const target = e.target;

      if (target.hasClass("locked"))
        return;

      self.commit();
      self.editing = target;

      self.cy.$(".activated").removeClass("activated");
      self.cy.$(".arc-source").removeClass("arc-source");
      self.cy.$(".arc-target").removeClass("arc-target");
      self.cy.$(".selected").removeClass("selected");

      this.showEditLabelBox(target);
      self.lock(target);

    });*/

    $('.dependency').contextmenu(function(e) {
      self.intercepted = true;
      console.log(e.target);
      const target = $(e.target);
      let targetId = $(this).attr('id');
      let arcSource = targetId.split('_')[2];
      let arcTarget = targetId.split('_')[1];
      if (target.hasClass('locked'))
        return;
      self.commit();
      $('.activated').removeClass('activated');
      if (target.hasClass('selected')) {

        $('#form-' + arcSource).removeClass('arc-source');
        $('#form-' + arcTarget).removeClass('arc-target');
        target.removeClass('selected');
        self.unlock();

      } else {

        $(".arc-source").removeClass("arc-source");
        $("#form-"+ arcSource).addClass("arc-source");

        $(".arc-target").removeClass("arc-target");
        $("#form-" + arcTarget).addClass("arc-target");

        $(".selected").removeClass("selected");
        target.addClass("selected");
        self.lock(target);
      }
    });

    $(".dependency, .deprel-label").on('click', function() {
      self.intercepted = true;
      console.log("clicked on deprel, editing now");
      // If we click on the text, we want to convert it to the deprel id
      let targetId = $(this).attr('id').replace('text-','');

      const target = $('#' + targetId);
      if (target.hasClass('locked')) {
        return;
      }
      self.commit();
      self.editing = target;

      $('.activated').removeClass('activated');
      $('.arc-source').removeClass('arc-source');
      $('.arc-target').removeClass('arc-target');
      $('.selected').removeClass('selected');

      self.showEditLabelBox(target);
      self.lock(target);
    });

    return this;
  }

  /**
   * Save the current graph config to `localStorage`.
   */
  save() {

    let serial = _.pick(config, "pan", "zoom", "locked_index", "locked_id", "locked_classes");
    serial = JSON.stringify(serial);
    utils.storage.setPrefs("graph", serial);
  }

  /**
   * Load the graph config from `localStorage` if it exists.
   */
  load() {

    let serial = utils.storage.getPrefs("graph");
    if (!serial)
      return;

    serial = JSON.parse(serial);
    config.set(serial);
  }

  /**
   * Save in-progress changes to the graph (labels being edited).
   */
  commit() {

    $(".input").removeClass("input");

    if (this.editing === null)
      return; // nothing to do

    if ($(".splitting").length) {

      const value = $("#edit").val();
      let index = value.indexOf(" ");
      index = index < 0 ? value.length : index;

      this.splitToken(this.editing, index);

    } else {

      const attr = this.editing.attr("attr"),
        value = utils.validate.attrValue(attr, $("#edit").val());

      if (attr == "deprel") {

        this.modifyDependency(this.editing, value);

      } else {
        const tokenNum = this.editing.attr("id").replace(/\D/g,"");
        this.tokens[tokenNum][attr] = value;
        this.editing = null;
        this.app.save({
          type: "set",
          indices: [this.app.corpus.index],
        });
      }
    }

    this.editing = null;
  }

  /**
   * Remove all the graph state that would indicate we're in the process of
   *  editing a label or activating a particular element.
   */
  clear() {

    // intercepted by clicking a canvas subobject || mousemove (i.e. drag) || #edit
    if (this.intercepted)
      return;

    this.commit();

    $(":focus").blur();

    $("*").removeClass("splitting activated multiword-active " +
                      "multiword-selected arc-source arc-target selected moving neighbor " +
                      "merge-source merge-left merge-right combine-source combine-left " +
                      "combine-right");

    this.moving_dependency = false;

    $("#mute").removeClass("activated");
    $("#edit").removeClass("activated");

    this.app.gui.status.refresh();
    this.unlock();
  }

  // ---------------------------------------------------------------------------
  // abstractions over modifying the corpus

  /**
   * Try to add `src` as a head for `tar`, save changes, and update graph.
   *
   * @param {CytoscapeNode} src
   * @param {CytoscapeNode} tar
   */
  makeDependency(src, tar) {

    try {
      //src = src.data('token');
      //tar = tar.data('token');
      tar.addHead(src);
      this.unlock();
      this.app.save({
        type: "set",
        indices: [this.app.corpus.index],
      });

    } catch (e) {

      if (e instanceof nx.NxError) {

        this.app.gui.status.error(e.message);

      } else {

        throw e;
      }
    }

    /*
    // TODO:
    // If the target POS tag is PUNCT set the deprel to @punct [99%]
    // IF the target POS tag is CCONJ set the deprel to @cc [88%]
    // IF the target POS tag is SCONJ set the deprel to @mark [86%]
    // IF the target POS tag is DET set the deprel to @det [83%]

    const POS_TO_REL = {
        'PUNCT': 'punct',
        'DET': 'det',
        'CCONJ': 'cc',
        'SCONJ': 'mark'
    }

    // TODO: Put this somewhere better
    if (thisToken.upostag in POS_TO_REL)
        sentAndPrev = changeConlluAttr(sent, indices, 'deprel', POS_TO_REL[thisToken.upostag]);

    let isValidDep = true;
    if (thisToken.upostag === 'PUNCT' && !is_projective_nodes(sent.tokens, [targetIndex])) {
        log.warn('writeArc(): Non-projective punctuation');
        isValidDep = false
    }*/
  }

  /**
   * Try to change the deprel for the dependency given by `ele` to `deprel`, save
   *  changes, and update graph.
   *
   * @param {CytoscapeEdge} ele
   * @param {String} deprel
   */
  modifyDependency(ele, deprel) {

    try {

      let id = ele.attr("id");
      let sourceNum = parseInt(id.split("_")[2]);
	    let targetNum = parseInt(id.split("_")[1]);
      let src = this.tokens[sourceNum];
      let tar = this.tokens[targetNum];
      tar.modifyHead(src, deprel);
      this.unlock();
      this.app.save({
        type: "set",
        indices: [this.app.corpus.index],
      });

    } catch (e) {

      if (e instanceof nx.NxError) {

        this.app.gui.status.error(e.message);

      } else {

        throw e;
      }
    }
  }

  /**
   * Try to remove the dependency given by `ele`, save changes, and update graph.
   *
   * @param {CytoscapeEdge} ele
   */
  removeDependency(ele) {

    try {
      let id = ele.attr("id");
      let sourceNum = parseInt(id.split("_")[2]);
	    let targetNum = parseInt(id.split("_")[1]);
      let src = this.tokens[sourceNum];
      let tar = this.tokens[targetNum];
      tar.removeHead(src);
      this.unlock();
      this.app.save({
        type: "set",
        indices: [this.app.corpus.index],
      });

    } catch (e) {

      if (e instanceof nx.NxError) {

        this.app.gui.status.error(e.message);

      } else {

        throw e;
      }
    }
  }

  insertEmptyTokenAfter(ele) {
    const sent = this.app.corpus.current;
    ele = ele.data("token");
    console.log("inserting empty token after", ele);

    try {

      const newToken = new nx.Token(sent, {
        form: "_",
        isEmpty: true,
      });

      const index = ele.indices.sup;
      // insert the new token after it
      sent.tokens = sent.tokens.slice(0, index + 1).concat(newToken).concat(sent.tokens.slice(index + 1));

      this.app.graph.intercepted = false;
      this.app.graph.clear();
      this.app.gui.refresh();

    } catch (e) {

      if (e instanceof nx.NxError) {

        this.app.gui.status.error(e.message);

      } else {

        throw e;
      }
    }
  }

  /**
   * Toggle whether `ele` is an empty node, save changes, and update the graph
   *
   * @param {CytoscapeNode} ele
   */
  toggleIsEmpty(ele) {

    console.log("toggling isEmpty");
    const sent = this.app.corpus.current;
    ele = ele.data("token");
    console.log(ele.isEmpty, ele);

    try {

      ele.setEmpty(!ele.isEmpty);
      this.unlock();
      this.app.save({
        type: "set",
        indices: [this.app.corpus.index],
      });

    } catch (e) {

      if (e instanceof nx.NxError) {

        this.app.gui.status.error(e.message);

      } else {

        throw e;
      }
    }
  }

  /**
   * Try to set `ele` as the root of the sentence, save changes, and update graph.
   *
   * @param {CytoscapeNode} ele
   */
  setRoot(ele) {

    const sent = this.app.corpus.current;
    let eleNum = ele.attr("id").replace(/\D/g, "");
    ele = this.tokens[eleNum];

    try {

      if (!this.app.corpus.enhanced)
        sent.root.dependents.clear();

      ele.addHead(sent.root, "root");
      this.unlock();
      this.app.save({
        type: "set",
        indices: [this.app.corpus.index],
      });

    } catch (e) {

      if (e instanceof nx.NxError) {

        this.app.gui.status.error(e.message);

      } else {

        throw e;
      }
    }
  }

  /**
   * Try to the token given by `ele` as `index`, save changes, and update graph.
   *
   * @param {CytoscapeNode} ele
   * @param {Number} index
   */
  splitToken(ele, index) {

    try {

      this.app.corpus.current.split(ele.data("token"), index);
      this.unlock();
      this.app.save({
        type: "set",
        indices: [this.app.corpus.index],
      });

    } catch (e) {

      if (e instanceof nx.NxError) {

        this.app.gui.status.error(e.message);

      } else {

        throw e;
      }
    }
  }

  /**
   * Try to the superToken given by `ele` into normal tokens save changes, and
   *  update graph.
   *
   * @param {CytoscapeNode} ele
   */
  splitSuperToken(ele) {

    try {

      this.app.corpus.current.split(ele.data("token"));
      this.unlock();
      this.app.save({
        type: "set",
        indices: [this.app.corpus.index],
      });

    } catch (e) {

      if (e instanceof nx.NxError) {

        this.app.gui.status.error(e.message);

      } else {

        throw e;
      }
    }
  }

  /**
   * Try to combine `src` and `tar` into a superToken, save changes, and update
   *  graph.
   *
   * @param {CytoscapeNode} src
   * @param {CytoscapeNode} tar
   */
  combine(src, tar) {

    try {

      this.app.corpus.current.combine(src, tar);
      this.unlock();
      this.app.save({
        type: "set",
        indices: [this.app.corpus.index],
      });

    } catch (e) {

      if (e instanceof nx.NxError) {

        this.app.gui.status.error(e.message);

      } else {

        throw e;
      }
    }
  }

  /**
   * Try to merge `src` and `tar` into a single normal token, save changes, and
   *  update graph.
   *
   * @param {CytoscapeNode} src
   * @param {CytoscapeNode} tar
   */
  merge(src, tar) {

    try {

      this.app.corpus.current.merge(src, tar);
      this.unlock();
      this.app.save({
        type: "set",
        indices: [this.app.corpus.index],
      });

    } catch (e) {

      if (e instanceof nx.NxError) {

        this.app.gui.status.error(e.message);

      } else {

        throw e;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // methods for traversing the graph

  /**
   * Get the `previous` form relative to the activated form (no wrapping).  This
   *  is useful for when we want to get the neighbors of a node (e.g. for merge
   *  or combine).  The `previous` form is the `form-node` with `clump` one less.
   *  If there is no `previous` form, returns undefined.
   *
   * @return {(CytoscapeCollection|undefined)}
   */
  getPrevForm() {

    let clump = this.cy.$(".activated").data("clump");
    if (clump === undefined)
      return;

    clump -= 1;

    return this.cy.$(`.form[clump = ${clump}]`);
  }

  /**
   * Get the `next` form relative to the activated form (no wrapping).  This
   *  is useful for when we want to get the neighbors of a node (e.g. for merge
   *  or combine).  The `next` form is the `form-node` with `clump` one greater.
   *  If there is no `next` form, returns undefined.
   *
   * @return {(CytoscapeCollection|undefined)}
   */
  getNextForm() {

    let clump = this.cy.$(".activated").data("clump");
    if (clump === undefined)
      return;

    clump += 1;

    return this.cy.$(`.form[clump = ${clump}]`);
  }

  /**
   * Show #edit on the `previous` cytoscape element, determined by the order it
   *  was drawn to the graph.
   */
  selectPrevEle() {

    let num = this.cy.$(".input").data("num");
    this.intercepted = false;
    this.clear();

    num += 1;
    if (num === 0)
      num = this.length;
    if (num > this.length)
      num = 1;

    const ele = this.cy.$(`[num = ${num}]`);
    this.editing = ele;
    if (ele.length)
      this.showEditLabelBox(ele);
  }

  /**
   * Show #edit on the `next` cytoscape element, determined by the order it
   *  was drawn to the graph.
   */
  selectNextEle() {

    let num = this.cy.$(".input").data("num");
    this.intercepted = false;
    this.clear();

    num -= 1;
    if (num === 0)
      num = this.length;
    if (num > this.length)
      num = 1;

    const ele = this.cy.$(`[num = ${num}]`);
    this.editing = ele;
    if (ele.length)
      this.showEditLabelBox(ele);
  }

  /**
   * Flash the #edit box, but stay in `splitting` mode (this affects what happens
   *  during `commit`).
   */
  flashTokenSplitInput(ele) {

    ele.addClass("splitting");
    this.editing = ele;
    this.showEditLabelBox(ele);
  }

  /**
   * Flash the #edit box around the current `input` node.  Also locks the target
   *  and flashes the #mute.
   */
  showEditLabelBox(target) {

    target.addClass("input");
    console.log(target);
    let textElement = $("#text-" + target.attr("id"));
    console.log(textElement);
    
    // get rid of direction arrows
    const label = textElement.text().replace(/[⊳⊲]/, "");

    // get bounding box
    /*let bbox = target.renderedBoundingBox();
    bbox.color = target.style('background-color');
    if (target.data('name') === 'dependency') {
      bbox.w = 100;
      bbox.h = this.cy.nodes()[0].renderedHeight();
      bbox.color = "white";

      if (this.app.corpus.is_vertical) {
        bbox.y1 += (bbox.y2 - bbox.y1) / 2 - 15;
        bbox.x1 = bbox.x2 - 70;
      } else {
        bbox.x1 += (bbox.x2 - bbox.x1) / 2 - 50;
      }
    }*/
    console.log(textElement[0].getBoundingClientRect())
    let textBCR = textElement[0].getBoundingClientRect();
    let offsetHeight = $("#graph-svg")[0].getBoundingClientRect().y;

    // TODO: rank the labels + make the style better
    const autocompletes = target.attr("id").includes("pos")
      ? utils.validate.U_POS
      : target.attr("id").includes("dep")
        ? utils.validate.U_DEPRELS
        : [];

    // add the edit input
    $("#edit")
      .val("")
      .focus()
      .val(label)
      .css("top", textBCR.y - offsetHeight)
      .css("left", textBCR.x)
      .css("height", textBCR.height)
      .css("width", textBCR.width)
      .attr("target", target.attr("id"))
      .addClass("activated")
      .selfcomplete({
        lookup: autocompletes,
        tabDisabled: false,
        autoSelectFirst: true,
        lookupLimit: 5,
        width: 'flex'
      });

    // add the background-mute div
    $("#mute").addClass("activated");
      /*.css('height', this.app.corpus.is_vertical
        ? `${this.length * 50}px`
        : $(window).width() - 10);*/

    $("#edit").focus(); // move cursor to the end
    if (target.attr("id").includes("dep")) {
      $("#edit").select(); // highlight the current contents
    }

    this.lock(target);
    this.app.gui.status.refresh();
  }

  // ---------------------------------------------------------------------------
  // methods for collaboration

  /**
   * Add `mouse` nodes for each of the users on the current corpus index.
   */
  drawMice() {
    this.app.collab.getMouseNodes().forEach(mouse => {
      const id = mouse.id.replace(/[#:]/g, "_");

      if (!this.cy.$(`#${id}.mouse`).length)
        this.cy.add({data: {id: id}, classes: "mouse"});

      this.cy.$(`#${id}.mouse`).position(mouse.position).css("background-color", "#" + mouse.color);
    });
  }

  /**
   * Add the `locked` class to each of the elements being edited by other users
   *  on the current corpus index.
   */
  setLocks() {

    /*this.cy.$(".locked")
        .removeClass("locked")
        .data("locked_by", null)
        .css("background-color", "")
        .css("line-color", "");

    this.app.collab.getLocks().forEach(lock => {
      this.cy.$("#" + lock.locked)
          .addClass("locked")
          .data("locked_by", lock.id)
          .css("background-color", "#" + lock.color)
          .css("line-color", "#" + lock.color);
    });*/
  }

  /**
   * Add a lock to `ele`, save it to the config, and broadcast it to the other
   *  users.
   *
   * @param {(CytoscapeEdge|CytoscapeNode)}
   */
  lock(ele) {

    if (!ele || !ele.length)
      return this.unlock();

    this.locked = ele;
    config.locked_index = this.app.corpus.index;
    config.locked_id = ele.attr('id');

    let keys = ele.attr("class").split(/\s+/);
    keys = _.intersection(keys, ["selected", "activated"
      , "multiword-active", "merge-source", "combine-source"]);

    config.locked_classes = keys.join(" ");
    this.save();
    if(this.app.online) {
      this.app.socket.broadcast("lock graph", ele.attr("id"));
    }
  }

  /**
   * Remove the lock for the current user, save and broadcast.
   */
  unlock() {

    this.locked = null;
    config.locked_index = null;
    config.locked_id = null;
    config.locked_classes = null;
    this.save();
    if (this.app.online) {
      this.app.socket.broadcast("unlock graph");
    }
  }
}

module.exports = Graph;
