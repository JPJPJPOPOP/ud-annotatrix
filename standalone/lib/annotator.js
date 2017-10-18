"use strict"

var FORMAT = "";
var FILENAME = 'corpora.txt'; // default name
var ROOT = './lib/';
var CONTENTS = "";
var AVAILABLESENTENCES = 0;
var HIDDEN_CODE_WINDOW = false;
var CURRENTSENTENCE = 0;
var RESULTS = [];
var LOC_ST_AVALIABLE = false;
var SERVER_RUNNING = false;
var AMBIGUOUS = false;
var LABELS = [];
 

function main() {
    head.js(
        ROOT + 'ext/jquery.min.js',
        ROOT + 'ext/jquery-ui.min.js',
        ROOT + 'ext/cytoscape.min.js',
        ROOT + 'ext/undomanager.js',

        // CoNLL-U parser from https://github.com/FrancessFractal/conllu
        ROOT + 'ext/conllu/conllu.js',

        // native project code
        ROOT + 'CG2conllu.js',
        ROOT + 'SD2conllu.js',
        ROOT + 'converters.js',
        ROOT + 'gui.js',
        ROOT + 'visualiser.js',
        ROOT + 'validation.js',
        ROOT + 'cy-style.js'
    );

    head.ready(function() {

        fetch('running').then(
            function(data) {
                console.log("Response from server, status: " + data["status"]);
                getCorpusData();
                SERVER_RUNNING = true;
            }); // TODO: to get rid of the error, read about promisses: https://qntm.org/files/promise/promise.html

        $(document).keyup(keyUpClassifier); // TODO: causes errors if called before the cy is initialised

        // undo support
        window.undoManager = new UndoManager();
        setUndos(window.undoManager);

        // trying to load the corpus from localStorage
        if (storageAvailable('localStorage')) {
            LOC_ST_AVALIABLE = true;
            if (localStorage.getItem("corpus") != null) {
                CONTENTS = localStorage.getItem("corpus");
                loadDataInIndex();
            };
        }
        else {
            console.log("localStorage is not avaliable :(")
            // add a nice message so the user has some idea how to fix this
            var warnMsg = document.createElement('p');
            warnMsg.innerHTML = "Unable to save to localStorage, maybe third-party cookies are blocked?";
            var warnLoc = document.getElementById('warning');
            warnLoc.appendChild(warnMsg);

        }

        // $("#indata").keyup(drawTree);
        $("#indata").bind("keyup", drawTree);
        $("#indata").bind("keyup", focusOut);
        $("#RTL").bind("change", switchRtlMode);
        $("#vertical").bind("change", switchAlignment);
        loadFromUrl();
    });

    document.getElementById('filename').addEventListener('change', loadFromFile, false);

    setTimeout(function(){
        if (SERVER_RUNNING) {
            $("#save").css("display", "block")
                .css("background-color", NORMAL);
        }
    }, 500);
}


function addHandlers() {
    // NOTE: If you change the style of a node (e.g. its selector) then
    // you also need to update the event handler here
    cy.on('click', 'node.wf', drawArcs);
    cy.on('cxttapend', 'edge.dependency', selectArc);
    cy.on('click', 'node.pos', changeNode);
    cy.on('click', '$node > node', selectSup);
    cy.on('cxttapend', 'node.wf', changeNode);
    cy.on('click', 'edge.dependency', changeNode);
    cy.on('click', 'edge.dependency-error', changeNode);
}


function loadFromUrl(argument) {
    //check if the URL contains arguments

    var parameters = window.location.search.slice(1);
    parameters = parameters.split('&')[1]
    if (parameters){
        var variables = parameters.map(function(arg){
            return arg.split('=')[1].replace(/\+/g, " "); 
        });

        $("#indata").val(variables[0]);

        drawTree();
    }
}


//Load Corpora from file
function loadFromFile(e) {
    CONTENTS = "";
    var file = e.target.files[0];
    FILENAME = file.name;

    // check if the code is invoked
    var ext = FILENAME.split(".")[FILENAME.split(".").length - 1]; // TODO: should be more beautiful way 
    if (ext == "txt") {
        FORMAT = "plain text";
    }

    if (!file) {
        return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
        CONTENTS = e.target.result;
        localStorage.setItem("corpus", CONTENTS);
        loadDataInIndex();
    };
    reader.readAsText(file);
}


function addSent() {
        AVAILABLESENTENCES = AVAILABLESENTENCES + 1; 
        showDataIndiv();    
}

function removeCurSent() {
    var conf = confirm("Do you want to remove the sentence?");
    if (conf) {
        var curSent = CURRENTSENTENCE;
        $("#indata").val("");
        CONTENTS = getTreebank();
        loadDataInIndex();
        CURRENTSENTENCE = curSent;
        if (CURRENTSENTENCE >= AVAILABLESENTENCES) {CURRENTSENTENCE--};
        showDataIndiv();    
    }
}


function loadDataInIndex() {
    RESULTS = [];
    AVAILABLESENTENCES = 0;
    CURRENTSENTENCE = 0;

    if (FORMAT == "plain text") {
        var splitted = CONTENTS.match(/[^ ].+?[.!?](?=( |$))/g);
    } else if (FORMAT == undefined) {
        var splitted = [];
    } else {
        var splitted = CONTENTS.split("\n\n");
    }

    console.log('loadDataInIndex ' + splitted.length)
    for (var i = splitted.length - 1; i >= 0; i--) {
        if (splitted[i].trim() === "") {
            splitted.splice(i, 1);
        }
    }

    AVAILABLESENTENCES = splitted.length;
            
    if (AVAILABLESENTENCES == 1 || AVAILABLESENTENCES == 0) {
        document.getElementById('nextSenBtn').disabled = true;
    } else {
        document.getElementById('nextSenBtn').disabled = false;
    }
            
    for (var i = 0; i < splitted.length; ++i) {
        var check = splitted[i];
        RESULTS.push(check);
    }
    showDataIndiv();
}

function showDataIndiv() {
    console.log('showDataIndiv()');
    if(RESULTS[CURRENTSENTENCE] != undefined) {
      document.getElementById('indata').value = (RESULTS[CURRENTSENTENCE]);
    } else {
      document.getElementById('indata').value = "";
    }
    document.getElementById('currentsen').value = (CURRENTSENTENCE+1);
    document.getElementById('totalsen').innerHTML = AVAILABLESENTENCES;
    drawTree();
}

function goToSenSent() {
    RESULTS[CURRENTSENTENCE] = document.getElementById("indata").value;
    CURRENTSENTENCE = parseInt(document.getElementById("currentsen").value) - 1;
    if (CURRENTSENTENCE < 0)  {
        CURRENTSENTENCE = 0;
    }
    if (CURRENTSENTENCE > (AVAILABLESENTENCES - 1))  {
        CURRENTSENTENCE = AVAILABLESENTENCES - 1;
    }
    if (CURRENTSENTENCE < (AVAILABLESENTENCES - 1)) {
        document.getElementById("nextSenBtn").disabled = false;
    }
    if (CURRENTSENTENCE == 0) {
        document.getElementById("prevSenBtn").disabled = true;
    }
    
    clearLabels();
    showDataIndiv();
}

function prevSenSent() {
    RESULTS[CURRENTSENTENCE] = document.getElementById("indata").value;
    CURRENTSENTENCE--;
    if (CURRENTSENTENCE < 0)  {
        CURRENTSENTENCE = 0;
    }
    if (CURRENTSENTENCE < (AVAILABLESENTENCES - 1)) {
        document.getElementById("nextSenBtn").disabled = false;
    }
    if (CURRENTSENTENCE == 0) {
        document.getElementById("prevSenBtn").disabled = true;
    }
    clearLabels();
    showDataIndiv();
}

//When Navigate to next item
function nextSenSent() {
    RESULTS[CURRENTSENTENCE] = document.getElementById("indata").value;
    CURRENTSENTENCE++;
    if(CURRENTSENTENCE >= AVAILABLESENTENCES) {
      CURRENTSENTENCE = AVAILABLESENTENCES;
    }
    if (CURRENTSENTENCE >= (AVAILABLESENTENCES - 1)) {
        document.getElementById("nextSenBtn").disabled = true;
    }
    if (CURRENTSENTENCE > 0) {
        document.getElementById("prevSenBtn").disabled = false;
    }
    clearLabels();
    showDataIndiv();
}

function clearLabels() {
    LABELS = [];
    var htmlLabels = document.getElementById('treeLabels');
    while (htmlLabels.firstChild) {
      htmlLabels.removeChild(htmlLabels.firstChild);
    }
}

//Export Corpora to file
function exportCorpora() {
    var finalcontent = getTreebank();
            
    var link = document.createElement('a');
    var mimeType = 'text/plain';
    document.body.appendChild(link); // needed for FF
    link.setAttribute('download', FILENAME);
    link.setAttribute('href', 'data:' + mimeType + ';charset=utf-8,' + encodeURIComponent(finalcontent));
    link.click();
}


function clearCorpus() {
    CONTENTS = "";
    AVAILABLESENTENCES = 0;
    CURRENTSENTENCE = 0;
    RESULTS = [];
    FORMAT = ""
    localStorage.setItem("corpus", "");
    $("#indata").val("");
    showDataIndiv() 
    window.location.reload();
    drawTree();
}


function getTreebank() {

    RESULTS[CURRENTSENTENCE] = document.getElementById("indata").value;
    var finalcontent = "";
    // loop through all the trees
    for(var x=0; x < RESULTS.length; x++){
        // add them to the final file, but get rid of any trailing whitespace
        finalcontent = finalcontent + RESULTS[x].trim();
        // if it's not the last tree, add two ewlines (e.g. one blank line)
        if(x != ((RESULTS.length)-1)){
            finalcontent = finalcontent + "\n\n";
        }
    }
    // output final newline
    return finalcontent + "\n\n";
}
        

function drawTree() {
    try {
        cy.destroy();
    } catch (err) {};

    var content = $("#indata").val();
    // remove extra spaces at the end of lines. #89
    content = content.replace(/ +\n/, '\n');
    $("#indata").val(content);
    FORMAT = detectFormat(content);

    $("#detected").html("Detected: " + FORMAT + " format");
	console.log(FORMAT);
	if (FORMAT == "CoNLL-U") {
		$("#viewOther").hide();
		$("#viewCG").removeClass("active");
		$("#viewOther").removeClass("active");
		$("#viewConllu").addClass("active");
	} else if (FORMAT == "CG3") {
		$("#viewOther").hide();
		$("#viewConllu").removeClass("active");
		$("#viewOther").removeClass("active");
		$("#viewCG").addClass("active");
	} else {
		$("#viewOther").show();
		$("#viewOther").addClass("active");
		$("#viewConllu").removeClass("active");
		$("#viewCG").removeClass("active");
		$("#viewOther").text(FORMAT);
	}
	 	

    if (FORMAT == "CG3") {
        content = CG2conllu(content)
        if (content == undefined) {
            AMBIGUOUS = true;
        } else {
            AMBIGUOUS = false;
        }
    };

    if (FORMAT == "SD") {
        content = SD2conllu(content);
    }

    if (FORMAT == "CoNLL-U" || (FORMAT == "CG3" && !AMBIGUOUS) || FORMAT == "SD") {
        var newContent = cleanConllu(content);
        if(newContent != content) {
            content = newContent;
            $("#indata").val(content);
        }

        conlluDraw(content);
        var inpSupport = $("<div id='mute'>"
            + "<input type='text' id='edit' class='hidden-input'/></div>");
        $("#cy").prepend(inpSupport);
        addHandlers();
    }

    if (LOC_ST_AVALIABLE) {
        localStorage.setItem("corpus", getTreebank()); // saving the data
    }

    if (AMBIGUOUS) {
        cantConvertCG();
    } else {
        clearWarning();
    }
}

function cleanConllu(content) {
    // if we don't find any tabs, then convert >1 space to tabs
    // TODO: this should probably go somewhere else, and be more 
     // robust, think about vietnamese D:
    var res = content.search("\n");
    if(res < 0) {
        return content;
    }
    // maybe someone is just trying to type conllu directly...
    var res = (content.match(/_/g)||[]).length;
    if(res <= 2) {
        return content;
    }
    var res = content.search("\t");
    if(res < 0) {
        console.log("no tabs");
        content = content.replace(/  */g, "\t");
    }
    // remove blank lines
    var lines = content.split("\n");
    var newContent = "";
    for(var i = 0; i < lines.length; i++) {
        if(lines[i].trim().length == 0) {
            continue;
        }
        // strip the extra tabs/spaces at the end of the line 
        newContent = newContent + lines[i].trim() + "\n";
    }
    return newContent;
}


function detectFormat(content) {
    clearLabels();
    //TODO: too many "hacks" and presuppositions. refactor.

    content = content.trim();
    var firstWord = content.replace(/\n/g, " ").split(" ")[0];
    
    // handling # comments at the beginning
    if (firstWord[0] === '#'){
        var following = 1;
        while (firstWord[0] === '#' && following < content.length){
            // TODO: apparently we need to log the thing or it won't register???
            console.log('detectFormat|while| ' + firstWord);
            firstWord = content.split("\n")[following];
            // pull out labels and put them in HTML, TODO: this probably
            // wants to go somewhere else.
            if(firstWord.search('# labels') >= 0) {
              var labels = firstWord.split("=")[1].split(" ");
              for(var i = 0; i < labels.length; i++) {
                var seen = false;
                for(var j = 0; j < LABELS.length; j++) {
                  if(labels[i] == LABELS[j]) {
                    seen = true; 
                  }
                }
                if(!seen) {
                  LABELS.push(labels[i]);
                }
              }
              var htmlLabels = document.getElementById('treeLabels');
              var labelMsg = document.createElement('span');
              for(var k = 0; k < LABELS.length; k++) { 
                labelMsg.append(LABELS[k]) ;
              }
              htmlLabels.append(labelMsg) ;
              console.log("FOUND LABELS:" + LABELS);
            }
            following ++;
        }
    }

    if (firstWord.match(/"<.*/)) {
        FORMAT = "CG3";
    } else if (firstWord.match(/1/)) {
        FORMAT = "CoNLL-U";

    // TODO: better plaintext recognition
//    } else if (!content.trim("\n").includes("\n")) {
//        FORMAT = "plain text";
    } else if (content.trim("\n").includes("(")) {
        FORMAT = "SD";
    } else { 
        FORMAT = "Unknown";
    }

    return FORMAT
}


function saveOnServer(evt) {
    var finalcontent = getTreebank();
    
    // sending data on server
    var treebank_id = location.href.split('/')[4];
    $.ajax({
        type: "POST",
        url: '/save',
        data: {
            "content": finalcontent,
            "treebank_id": treebank_id
        },
        dataType: "json",
        success: function(data){
            console.log('Load was performed.');
        }
    });
}


function getCorpusData() {
    var treebank_id = location.href.split('/')[4];
    $.ajax({
        type: "POST",
        url: "/load",
        data: {"treebank_id": treebank_id},
        dataType: "json",
        success: loadData
    });
}


function loadData(data) {
    if (data["content"]) {
        CONTENTS = data["content"];
    }
    loadDataInIndex();
}


function showHelp() {
    /* Opens help in a new tab. */
    var win = window.open("help.html", '_blank');
    win.focus();
}


function storageAvailable(type) {
    /* Taken from https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API */
    try {
        var storage = window[type],
            x = '__storage_test__';
        storage.setItem(x, x);
        storage.removeItem(x);
        return true;
    }
    catch(e) {
        return e instanceof DOMException && (
            // everything except Firefox
            e.code === 22 ||
            // Firefox
            e.code === 1014 ||
            // test name field too, because code might not be present
            // everything except Firefox
            e.name === 'QuotaExceededError' ||
            // Firefox
            e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
            // acknowledge QuotaExceededError only if there's something already stored
            storage.length !== 0;
    }
}

function toggleCodeWindow() {
    console.log('toggleCodeWindow()');
    if(!HIDDEN_CODE_WINDOW) {
      $("#codeVisibleButton").attr('class', 'fa fa-chevron-down');
      $("#indata").css('visibility', 'hidden');
      $("#indata").css('height', '0px');
      HIDDEN_CODE_WINDOW = true;
    } else { 
      $("#codeVisibleButton").attr('class', 'fa fa-chevron-up');
      $("#indata").css('visibility', '');
      $("#indata").css('height', '200px');
      HIDDEN_CODE_WINDOW = false;
    }
}

function focusOut(key) {
    if (key.which == ESC) {
        this.blur();
    }
}


main()
