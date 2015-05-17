/*global Util, ButtonsData, Button, Selection, DefaultButton,
 AnchorExtension, FontSizeExtension, Extension, extensionDefaults,
 Toolbar, AnchorPreview, AutoLinker, ImageDragging,
 Events, Placeholders, editorDefaults */

function MediumEditor(elements, options) {
    'use strict';
    return this.init(elements, options);
}

(function () {
    'use strict';

    // Event handlers that shouldn't be exposed externally

    function handleDisabledEnterKeydown(event, element) {
        if (this.options.disableReturn || element.getAttribute('data-disable-return')) {
            event.preventDefault();
        } else if (this.options.disableDoubleReturn || element.getAttribute('data-disable-double-return')) {
            var node = Util.getSelectionStart(this.options.ownerDocument);
            if (node && node.textContent.trim() === '') {
                event.preventDefault();
            }
        }
    }

    function handleTabKeydown(event) {
        // Override tab only for pre nodes
        var node = Util.getSelectionStart(this.options.ownerDocument),
            tag = node && node.tagName.toLowerCase();

        if (tag === 'pre') {
            event.preventDefault();
            Util.insertHTMLCommand(this.options.ownerDocument, '    ');
        }

        // Tab to indent list structures!
        if (Util.isListItem(node)) {
            event.preventDefault();

            // If Shift is down, outdent, otherwise indent
            if (event.shiftKey) {
                this.options.ownerDocument.execCommand('outdent', false, null);
            } else {
                this.options.ownerDocument.execCommand('indent', false, null);
            }
        }
    }

    function handleBlockDeleteKeydowns(event) {
        var range, sel, p, node = Util.getSelectionStart(this.options.ownerDocument),
            tagName = node.tagName.toLowerCase(),
            isEmpty = /^(\s+|<br\/?>)?$/i,
            isHeader = /h\d/i;

        if ((event.which === Util.keyCode.BACKSPACE || event.which === Util.keyCode.ENTER) &&
                // has a preceeding sibling
                node.previousElementSibling &&
                // in a header
                isHeader.test(tagName) &&
                // at the very end of the block
                Selection.getCaretOffsets(node).left === 0) {
            if (event.which === Util.keyCode.BACKSPACE && isEmpty.test(node.previousElementSibling.innerHTML)) {
                // backspacing the begining of a header into an empty previous element will
                // change the tagName of the current node to prevent one
                // instead delete previous node and cancel the event.
                node.previousElementSibling.parentNode.removeChild(node.previousElementSibling);
                event.preventDefault();
            } else if (event.which === Util.keyCode.ENTER) {
                // hitting return in the begining of a header will create empty header elements before the current one
                // instead, make "<p><br></p>" element, which are what happens if you hit return in an empty paragraph
                p = this.options.ownerDocument.createElement('p');
                p.innerHTML = '<br>';
                node.previousElementSibling.parentNode.insertBefore(p, node);
                event.preventDefault();
            }
        } else if (event.which === Util.keyCode.DELETE &&
                    // between two sibling elements
                    node.nextElementSibling &&
                    node.previousElementSibling &&
                    // not in a header
                    !isHeader.test(tagName) &&
                    // in an empty tag
                    isEmpty.test(node.innerHTML) &&
                    // when the next tag *is* a header
                    isHeader.test(node.nextElementSibling.tagName)) {
            // hitting delete in an empty element preceding a header, ex:
            //  <p>[CURSOR]</p><h1>Header</h1>
            // Will cause the h1 to become a paragraph.
            // Instead, delete the paragraph node and move the cursor to the begining of the h1

            // remove node and move cursor to start of header
            range = this.options.ownerDocument.createRange();
            sel = this.options.ownerDocument.getSelection();

            range.setStart(node.nextElementSibling, 0);
            range.collapse(true);

            sel.removeAllRanges();
            sel.addRange(range);

            node.previousElementSibling.parentNode.removeChild(node);

            event.preventDefault();
        } else if (event.which === Util.keyCode.BACKSPACE &&
                tagName === 'li' &&
                // hitting backspace inside an empty li
                isEmpty.test(node.innerHTML) &&
                // is first element (no preceeding siblings)
                !node.previousElementSibling &&
                // parent also does not have a sibling
                !node.parentElement.previousElementSibling &&
                // is not the only li in a list
                node.nextElementSibling.tagName.toLowerCase() === 'li') {
            // backspacing in an empty first list element in the first list (with more elements) ex:
            //  <ul><li>[CURSOR]</li><li>List Item 2</li></ul>
            // will remove the first <li> but add some extra element before (varies based on browser)
            // Instead, this will:
            // 1) remove the list element
            // 2) create a paragraph before the list
            // 3) move the cursor into the paragraph

            // create a paragraph before the list
            p = this.options.ownerDocument.createElement('p');
            p.innerHTML = '<br>';
            node.parentElement.parentElement.insertBefore(p, node.parentElement);

            // move the cursor into the new paragraph
            range = this.options.ownerDocument.createRange();
            sel = this.options.ownerDocument.getSelection();
            range.setStart(p, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);

            // remove the list element
            node.parentElement.removeChild(node);

            event.preventDefault();
        }
    }

    function handleKeyup(event) {
        var node = Util.getSelectionStart(this.options.ownerDocument),
            tagName;

        if (!node) {
            return;
        }

        if (node.getAttribute('data-medium-element') && node.children.length === 0) {
            this.options.ownerDocument.execCommand('formatBlock', false, 'p');
        }

        if (event.which === Util.keyCode.ENTER && !Util.isListItem(node)) {
            tagName = node.tagName.toLowerCase();
            // For anchor tags, unlink
            if (tagName === 'a') {
                this.options.ownerDocument.execCommand('unlink', false, null);
            } else if (!event.shiftKey) {
                // only format block if this is not a header tag
                if (!/h\d/.test(tagName)) {
                    this.options.ownerDocument.execCommand('formatBlock', false, 'p');
                }
            }
        }
    }

    // Internal helper methods which shouldn't be exposed externally

    function createElementsArray(selector) {
        if (!selector) {
            selector = [];
        }
        // If string, use as query selector
        if (typeof selector === 'string') {
            selector = this.options.ownerDocument.querySelectorAll(selector);
        }
        // If element, put into array
        if (Util.isElement(selector)) {
            selector = [selector];
        }
        // Convert NodeList (or other array like object) into an array
        var elements = Array.prototype.slice.apply(selector);

        // Loop through elements and convert textarea's into divs
        this.elements = [];
        elements.forEach(function (element) {
            if (element.tagName.toLowerCase() === 'textarea') {
                this.elements.push(createContentEditable.call(this, element));
            } else {
                this.elements.push(element);
            }
        }, this);
    }

    function initExtension(extension, name, instance) {
        if (extension.parent) {
            extension.base = instance;
        }
        if (typeof extension.init === 'function') {
            extension.init(instance);
        }
        if (!extension.name) {
            extension.name = name;
        }
        return extension;
    }

    function shouldAddDefaultAnchorPreview() {
        var i,
            shouldAdd = false;

        // If anchor-preview is disabled, don't add
        if (this.options.disableAnchorPreview) {
            return false;
        }
        // If anchor-preview extension has been overriden, don't add
        if (this.options.extensions['anchor-preview']) {
            return false;
        }
        // If toolbar is disabled, don't add
        if (this.options.disableToolbar) {
            return false;
        }
        // If all elements have 'data-disable-toolbar' attribute, don't add
        for (i = 0; i < this.elements.length; i += 1) {
            if (!this.elements[i].getAttribute('data-disable-toolbar')) {
                shouldAdd = true;
                break;
            }
        }

        return shouldAdd;
    }

    function shouldAddDefaultAutoLink() {
        if (this.options.extensions['auto-link']) {
            return false;
        }

        return !!this.options.autoLink;
    }

    function shouldAddDefaultImageDragging() {
        if (this.options.extensions['image-dragging']) {
            return false;
        }

        return !!this.options.imageDragging;
    }

    function createContentEditable(textarea) {
        var div = this.options.ownerDocument.createElement('div'),
            id = (+new Date()),
            attributesToClone = [
                'data-disable-editing',
                'data-disable-toolbar',
                'data-placeholder',
                'data-disable-return',
                'data-disable-double-return',
                'data-disable-preview',
                'spellcheck'
            ];

        div.className = textarea.className;
        div.id = id;
        div.innerHTML = textarea.value;
        div.setAttribute('medium-editor-textarea-id', id);
        attributesToClone.forEach(function (attr) {
            if (textarea.hasAttribute(attr)) {
                div.setAttribute(attr, textarea.getAttribute(attr));
            }
        });

        textarea.classList.add('medium-editor-hidden');
        textarea.setAttribute('medium-editor-textarea-id', id);
        textarea.parentNode.insertBefore(
            div,
            textarea
        );

        return div;
    }

    function initElements() {
        this.elements.forEach(function (element, index) {
            if (!this.options.disableEditing && !element.getAttribute('data-disable-editing')) {
                element.setAttribute('contentEditable', true);
                element.setAttribute('spellcheck', this.options.spellcheck);
            }
            if (!element.getAttribute('data-placeholder')) {
                element.setAttribute('data-placeholder', this.options.placeholder);
            }
            element.setAttribute('data-medium-element', true);
            element.setAttribute('role', 'textbox');
            element.setAttribute('aria-multiline', true);
            element.setAttribute('medium-editor-index', index);

            if (element.hasAttribute('medium-editor-textarea-id')) {
                this.on(element, 'input', function (event) {
                    var target = event.target,
                        textarea = target.parentNode.querySelector('textarea[medium-editor-textarea-id="' + target.getAttribute('medium-editor-textarea-id') + '"]');
                    if (textarea) {
                        textarea.value = this.serialize()[target.id].value;
                    }
                }.bind(this));
            }
        }, this);
    }

    function initToolbar() {
        if (this.toolbar || this.options.disableToolbar) {
            return false;
        }

        var addToolbar = this.elements.some(function (element) {
            return !element.getAttribute('data-disable-toolbar');
        });

        if (addToolbar) {
            this.toolbar = new Toolbar(this);
            this.options.elementsContainer.appendChild(this.toolbar.getToolbarElement());
        }
    }

    function attachHandlers() {
        var i;

        // attach to tabs
        this.subscribe('editableKeydownTab', handleTabKeydown.bind(this));

        // Bind keys which can create or destroy a block element: backspace, delete, return
        this.subscribe('editableKeydownDelete', handleBlockDeleteKeydowns.bind(this));
        this.subscribe('editableKeydownEnter', handleBlockDeleteKeydowns.bind(this));

        // disabling return or double return
        if (this.options.disableReturn || this.options.disableDoubleReturn) {
            this.subscribe('editableKeydownEnter', handleDisabledEnterKeydown.bind(this));
        } else {
            for (i = 0; i < this.elements.length; i += 1) {
                if (this.elements[i].getAttribute('data-disable-return') || this.elements[i].getAttribute('data-disable-double-return')) {
                    this.subscribe('editableKeydownEnter', handleDisabledEnterKeydown.bind(this));
                    break;
                }
            }
        }

        // if we're not disabling return, add a handler to help handle cleanup
        // for certain cases when enter is pressed
        if (!this.options.disableReturn) {
            this.elements.forEach(function (element) {
                if (!element.getAttribute('data-disable-return')) {
                    this.on(element, 'keyup', handleKeyup.bind(this));
                }
            }, this);
        }
    }

    function initPasteHandler(options) {
        // Backwards compatability
        var defaultsBC = {
            forcePlainText: this.options.forcePlainText, // deprecated
            cleanPastedHTML: this.options.cleanPastedHTML, // deprecated
            disableReturn: this.options.disableReturn,
            targetBlank: this.options.targetBlank,
            'window': this.options.contentWindow,
            'document': this.options.ownerDocument
        };

        return new MediumEditor.extensions.paste(
            Util.extend({}, options, defaultsBC)
        );
    }

    function initCommands() {
        var buttons = this.options.buttons,
            extensions = this.options.extensions,
            ext,
            name;
        this.commands = [];

        buttons.forEach(function (buttonName) {
            if (extensions[buttonName]) {
                ext = initExtension(extensions[buttonName], buttonName, this);
                this.commands.push(ext);
            } else if (buttonName === 'anchor') {
                ext = initExtension(new MediumEditor.extensions.anchorForm(), buttonName, this);
                this.commands.push(ext);
            } else if (buttonName === 'fontsize') {
                ext = initExtension(new MediumEditor.extensions.fontsizeForm(), buttonName, this);
                this.commands.push(ext);
            } else if (ButtonsData.hasOwnProperty(buttonName)) {
                ext = initExtension(new Button(ButtonsData[buttonName]), buttonName, this);
                this.commands.push(ext);
            }
        }, this);

        for (name in extensions) {
            if (extensions.hasOwnProperty(name) && buttons.indexOf(name) === -1) {
                ext = initExtension(extensions[name], name, this);
                this.commands.push(ext);
            }
        }

        // Only add default paste extension if it wasn't overriden
        if (!this.options.extensions['paste']) {
            this.commands.push(initExtension(initPasteHandler.call(this, this.options.paste), 'paste', this));
        }

        // Add AnchorPreview as extension if needed
        if (shouldAddDefaultAnchorPreview.call(this)) {
            this.commands.push(initExtension(new AnchorPreview(), 'anchor-preview', this));
        }

        if (shouldAddDefaultAutoLink.call(this)) {
            this.commands.push(initExtension(new AutoLinker(), 'auto-link', this));
        }

        if (shouldAddDefaultImageDragging.call(this)) {
            this.commands.push(initExtension(new ImageDragging(), 'image-dragging', this));
        }
    }

    function mergeOptions(defaults, options) {
        // warn about using deprecated properties
        if (options) {
            [['forcePlainText', 'paste.forcePlainText'],
             ['cleanPastedHTML', 'paste.cleanPastedHTML']].forEach(function (pair) {
                if (options.hasOwnProperty(pair[0]) && options[pair[0]] !== undefined) {
                    Util.deprecated(pair[0], pair[1], 'v5.0.0');
                }
            });
        }

        var nestedMerges = ['paste'],
            tempOpts = Util.extend({}, options);

        nestedMerges.forEach(function (toMerge) {
            if (!tempOpts[toMerge]) {
                tempOpts[toMerge] = defaults[toMerge];
            } else {
                tempOpts[toMerge] = Util.defaults({}, tempOpts[toMerge], defaults[toMerge]);
            }
        });

        return Util.defaults(tempOpts, defaults);
    }

    function execActionInternal(action, opts) {
        /*jslint regexp: true*/
        var appendAction = /^append-(.+)$/gi,
            match;
        /*jslint regexp: false*/

        // Actions starting with 'append-' should attempt to format a block of text ('formatBlock') using a specific
        // type of block element (ie append-blockquote, append-h1, append-pre, etc.)
        match = appendAction.exec(action);
        if (match) {
            return Util.execFormatBlock(this.options.ownerDocument, match[1]);
        }

        if (action === 'fontSize') {
            return this.options.ownerDocument.execCommand('fontSize', false, opts.size);
        }

        if (action === 'createLink') {
            return this.createLink(opts);
        }

        if (action === 'image') {
            return this.options.ownerDocument.execCommand('insertImage', false, this.options.contentWindow.getSelection());
        }

        return this.options.ownerDocument.execCommand(action, false, null);
    }

    // deprecate
    MediumEditor.statics = {
        ButtonsData: ButtonsData,
        DefaultButton: DefaultButton,
        AnchorExtension: AnchorExtension,
        FontSizeExtension: FontSizeExtension,
        Toolbar: Toolbar,
        AnchorPreview: AnchorPreview
    };

    MediumEditor.Extension = Extension;

    MediumEditor.extensions = extensionDefaults;
    MediumEditor.util = Util;
    MediumEditor.selection = Selection;

    MediumEditor.prototype = {

        defaults: editorDefaults,

        // NOT DOCUMENTED - exposed for backwards compatability
        init: function (elements, options) {
            var uniqueId = 1;

            this.options = mergeOptions.call(this, this.defaults, options);
            createElementsArray.call(this, elements);
            if (this.elements.length === 0) {
                return;
            }

            if (!this.options.elementsContainer) {
                this.options.elementsContainer = this.options.ownerDocument.body;
            }

            while (this.options.elementsContainer.querySelector('#medium-editor-toolbar-' + uniqueId)) {
                uniqueId = uniqueId + 1;
            }

            this.id = uniqueId;

            return this.setup();
        },

        setup: function () {
            if (this.isActive) {
                return;
            }

            this.events = new Events(this);
            this.isActive = true;

            // Call initialization helpers
            initElements.call(this);
            initCommands.call(this);
            initToolbar.call(this);
            attachHandlers.call(this);

            if (!this.options.disablePlaceholders) {
                this.placeholders = new Placeholders(this);
            }
        },

        destroy: function () {
            if (!this.isActive) {
                return;
            }

            this.isActive = false;

            if (this.toolbar !== undefined) {
                this.toolbar.deactivate();
                delete this.toolbar;
            }

            this.elements.forEach(function (element) {
                element.removeAttribute('contentEditable');
                element.removeAttribute('spellcheck');
                element.removeAttribute('data-medium-element');

                // Remove any elements created for textareas
                if (element.hasAttribute('medium-editor-textarea-id')) {
                    var textarea = element.parentNode.querySelector('textarea[medium-editor-textarea-id="' + element.getAttribute('medium-editor-textarea-id') + '"]');
                    if (textarea) {
                        // Un-hide the textarea
                        textarea.classList.remove('medium-editor-hidden');
                    }
                    if (element.parentNode) {
                        element.parentNode.removeChild(element);
                    }
                }
            }, this);
            this.elements = [];

            this.commands.forEach(function (extension) {
                if (typeof extension.deactivate === 'function') {
                    extension.deactivate();
                }
            }, this);

            this.events.destroy();
        },

        on: function (target, event, listener, useCapture) {
            this.events.attachDOMEvent(target, event, listener, useCapture);
        },

        off: function (target, event, listener, useCapture) {
            this.events.detachDOMEvent(target, event, listener, useCapture);
        },

        subscribe: function (event, listener) {
            this.events.attachCustomEvent(event, listener);
        },

        unsubscribe: function (event, listener) {
            this.events.detachCustomEvent(event, listener);
        },

        delay: function (fn) {
            var self = this;
            return setTimeout(function () {
                if (self.isActive) {
                    fn();
                }
            }, this.options.delay);
        },

        serialize: function () {
            var i,
                elementid,
                content = {};
            for (i = 0; i < this.elements.length; i += 1) {
                elementid = (this.elements[i].id !== '') ? this.elements[i].id : 'element-' + i;
                content[elementid] = {
                    value: this.elements[i].innerHTML.trim()
                };
            }
            return content;
        },

        getExtensionByName: function (name) {
            var extension;
            if (this.commands && this.commands.length) {
                this.commands.some(function (ext) {
                    if (ext.name === name) {
                        extension = ext;
                        return true;
                    }
                    return false;
                });
            }
            return extension;
        },

        /**
         * NOT DOCUMENTED - exposed for backwards compatability
         * Helper function to call a method with a number of parameters on all registered extensions.
         * The function assures that the function exists before calling.
         *
         * @param {string} funcName name of the function to call
         * @param [args] arguments passed into funcName
         */
        callExtensions: function (funcName) {
            if (arguments.length < 1) {
                return;
            }

            var args = Array.prototype.slice.call(arguments, 1),
                ext,
                name;

            for (name in this.options.extensions) {
                if (this.options.extensions.hasOwnProperty(name)) {
                    ext = this.options.extensions[name];
                    if (ext[funcName] !== undefined) {
                        ext[funcName].apply(ext, args);
                    }
                }
            }
            return this;
        },

        stopSelectionUpdates: function () {
            this.preventSelectionUpdates = true;
        },

        startSelectionUpdates: function () {
            this.preventSelectionUpdates = false;
        },

        // NOT DOCUMENTED - exposed as extension helper and for backwards compatability
        checkSelection: function () {
            if (this.toolbar) {
                this.toolbar.checkState();
            }
            return this;
        },

        // Wrapper around document.queryCommandState for checking whether an action has already
        // been applied to the current selection
        queryCommandState: function (action) {
            var fullAction = /^full-(.+)$/gi,
                match,
                queryState = null;

            // Actions starting with 'full-' need to be modified since this is a medium-editor concept
            match = fullAction.exec(action);
            if (match) {
                action = match[1];
            }

            try {
                queryState = this.options.ownerDocument.queryCommandState(action);
            } catch (exc) {
                queryState = null;
            }

            return queryState;
        },

        execAction: function (action, opts) {
            /*jslint regexp: true*/
            var fullAction = /^full-(.+)$/gi,
                match,
                result;
            /*jslint regexp: false*/

            // Actions starting with 'full-' should be applied to to the entire contents of the editable element
            // (ie full-bold, full-append-pre, etc.)
            match = fullAction.exec(action);
            if (match) {
                // Store the current selection to be restored after applying the action
                this.saveSelection();
                // Select all of the contents before calling the action
                this.selectAllContents();
                result = execActionInternal.call(this, match[1], opts);
                // Restore the previous selection
                this.restoreSelection();
            } else {
                result = execActionInternal.call(this, action, opts);
            }

            // do some DOM clean-up for known browser issues after the action
            if (action === 'insertunorderedlist' || action === 'insertorderedlist') {
                Util.cleanListDOM(this.getSelectedParentElement());
            }

            this.checkSelection();
            return result;
        },

        getSelectedParentElement: function (range) {
            if (range === undefined) {
                range = this.options.contentWindow.getSelection().getRangeAt(0);
            }
            return Selection.getSelectedParentElement(range);
        },

        // NOT DOCUMENTED - exposed as extension helper
        hideToolbarDefaultActions: function () {
            if (this.toolbar) {
                this.toolbar.hideToolbarDefaultActions();
            }
            return this;
        },

        // NOT DOCUMENTED - exposed as extension helper and for backwards compatability
        setToolbarPosition: function () {
            if (this.toolbar) {
                this.toolbar.setToolbarPosition();
            }
        },

        selectAllContents: function () {
            var currNode = Selection.getSelectionElement(this.options.contentWindow);

            if (currNode) {
                // Move to the lowest descendant node that still selects all of the contents
                while (currNode.children.length === 1) {
                    currNode = currNode.children[0];
                }

                this.selectElement(currNode);
            }
        },

        selectElement: function (element) {
            Selection.selectNode(element, this.options.ownerDocument);

            var selElement = Selection.getSelectionElement(this.options.contentWindow);
            if (selElement) {
                this.events.focusElement(selElement);
            }
        },

        getFocusedElement: function () {
            var focused;
            this.elements.some(function (element) {
                // Find the element that has focus
                if (!focused && element.getAttribute('data-medium-focused')) {
                    focused = element;
                }

                // bail if we found the element that had focus
                return !!focused;
            }, this);

            return focused;
        },

        // http://stackoverflow.com/questions/17678843/cant-restore-selection-after-html-modify-even-if-its-the-same-html
        // Tim Down
        // TODO: move to selection.js and clean up old methods there
        exportSelection: function () {
            var selectionState = null,
                selection = this.options.contentWindow.getSelection(),
                range,
                preSelectionRange,
                start,
                editableElementIndex = -1;

            if (selection.rangeCount > 0) {
                range = selection.getRangeAt(0);
                preSelectionRange = range.cloneRange();

                // Find element current selection is inside
                this.elements.some(function (el, index) {
                    if (el === range.startContainer || Util.isDescendant(el, range.startContainer)) {
                        editableElementIndex = index;
                        return true;
                    }
                    return false;
                });

                if (editableElementIndex > -1) {
                    preSelectionRange.selectNodeContents(this.elements[editableElementIndex]);
                    preSelectionRange.setEnd(range.startContainer, range.startOffset);
                    start = preSelectionRange.toString().length;

                    selectionState = {
                        start: start,
                        end: start + range.toString().length,
                        editableElementIndex: editableElementIndex
                    };
                }
            }

            if (selectionState !== null && selectionState.editableElementIndex === 0) {
                delete selectionState.editableElementIndex;
            }

            return selectionState;
        },

        saveSelection: function () {
            this.selectionState = this.exportSelection();
        },

        // http://stackoverflow.com/questions/17678843/cant-restore-selection-after-html-modify-even-if-its-the-same-html
        // Tim Down
        // TODO: move to selection.js and clean up old methods there
        importSelection: function (inSelectionState) {
            if (!inSelectionState) {
                return;
            }

            var editableElementIndex = inSelectionState.editableElementIndex === undefined ?
                                                0 : inSelectionState.editableElementIndex,
                selectionState = {
                    editableElementIndex: editableElementIndex,
                    start: inSelectionState.start,
                    end: inSelectionState.end
                },
                editableElement = this.elements[selectionState.editableElementIndex],
                charIndex = 0,
                range = this.options.ownerDocument.createRange(),
                nodeStack = [editableElement],
                node,
                foundStart = false,
                stop = false,
                i,
                sel,
                nextCharIndex;

            range.setStart(editableElement, 0);
            range.collapse(true);

            node = nodeStack.pop();
            while (!stop && node) {
                if (node.nodeType === 3) {
                    nextCharIndex = charIndex + node.length;
                    if (!foundStart && selectionState.start >= charIndex && selectionState.start <= nextCharIndex) {
                        range.setStart(node, selectionState.start - charIndex);
                        foundStart = true;
                    }
                    if (foundStart && selectionState.end >= charIndex && selectionState.end <= nextCharIndex) {
                        range.setEnd(node, selectionState.end - charIndex);
                        stop = true;
                    }
                    charIndex = nextCharIndex;
                } else {
                    i = node.childNodes.length - 1;
                    while (i >= 0) {
                        nodeStack.push(node.childNodes[i]);
                        i -= 1;
                    }
                }
                if (!stop) {
                    node = nodeStack.pop();
                }
            }

            sel = this.options.contentWindow.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        },

        restoreSelection: function () {
            this.importSelection(this.selectionState);
        },

        createLink: function (opts) {
            var customEvent,
                i;

            if (opts.url && opts.url.trim().length > 0) {
                this.options.ownerDocument.execCommand('createLink', false, opts.url);

                if (this.options.targetBlank || opts.target === '_blank') {
                    Util.setTargetBlank(Util.getSelectionStart(this.options.ownerDocument), opts.url);
                }

                if (opts.buttonClass) {
                    Util.addClassToAnchors(Util.getSelectionStart(this.options.ownerDocument), opts.buttonClass);
                }
            }

            if (this.options.targetBlank || opts.target === '_blank' || opts.buttonClass) {
                customEvent = this.options.ownerDocument.createEvent('HTMLEvents');
                customEvent.initEvent('input', true, true, this.options.contentWindow);
                for (i = 0; i < this.elements.length; i += 1) {
                    this.elements[i].dispatchEvent(customEvent);
                }
            }
        },

        // alias for setup - keeping for backwards compatability
        activate: function () {
            Util.deprecatedMethod.call(this, 'activate', 'setup', arguments, 'v5.0.0');
        },

        // alias for destroy - keeping for backwards compatability
        deactivate: function () {
            Util.deprecatedMethod.call(this, 'deactivate', 'destroy', arguments, 'v5.0.0');
        },

        cleanPaste: function (text) {
            this.getExtensionByName('paste').cleanPaste(text);
        },

        pasteHTML: function (html, options) {
            this.getExtensionByName('paste').pasteHTML(html, options);
        }
    };
}());
