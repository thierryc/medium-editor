/*global Button, FormExtension,
    AnchorForm, AutoLinker, FontSizeForm, ImageDragging, PasteHandler */

var extensionDefaults;
(function () {
    'use strict';

    extensionDefaults = {
        button: Button,
        form: FormExtension,

        anchor: AnchorForm,
        autoLink: AutoLinker,
        fontSize: FontSizeForm,
        imageDragging: ImageDragging,
        paste: PasteHandler
    };
})();
