/**
 * Antigravity - Mask Splitter & Cropper for After Effects (Final Version)
 * 
 * Instructions:
 * 1. Select a layer with multiple masks on it.
 * 2. Run this script.
 * 3. Choose your processing mode and click "Split Masks".
 */

(function(thisObj) {
    function showUI(thisObj) {
        var win = (thisObj instanceof Panel) ? thisObj : new Window("palette", "Antigravity Mask Splitter", undefined, {resizeable: true});
        win.spacing = 10;
        win.margins = 15;

        var descText = win.add("statictext", undefined, "Isolate and crop multiple masks from a single layer.", {multiline: true});
        descText.alignment = ["fill", "top"];

        var modeGroup = win.add("panel", undefined, "Processing Mode");
        modeGroup.alignment = ["fill", "top"];
        modeGroup.alignChildren = "left";
        modeGroup.spacing = 8;
        modeGroup.margins = 15;

        var radIsolate = modeGroup.add("radiobutton", undefined, "Isolate Masks & Center Anchor Points (No Pre-Comps)");
        radIsolate.value = true;
        var radCrop = modeGroup.add("radiobutton", undefined, "Isolate & Crop to Pre-Compositions");

        var btnSplit = win.add("button", undefined, "Split Masks");
        btnSplit.alignment = ["fill", "bottom"];

        var helpText = win.add("statictext", undefined, "Note: Run on static layers before starting animation.", {multiline: true});
        helpText.alignment = ["fill", "bottom"];
        helpText.graphics.foregroundColor = win.graphics.newPen(win.graphics.PenType.SOLID_COLOR, [0.5, 0.5, 0.5], 1);

        btnSplit.onClick = function() {
            var comp = app.project.activeItem;
            if (!comp || !(comp instanceof CompItem)) {
                alert("Please open a composition and select a layer.");
                return;
            }
            if (comp.selectedLayers.length === 0) {
                alert("Please select a layer with multiple masks.");
                return;
            }

            var layer = comp.selectedLayers[0];
            var maskGroup = layer.property("ADBE Mask Parade");
            
            if (!maskGroup || maskGroup.numProperties === 0) {
                alert("The selected layer does not have any masks.");
                return;
            }

            app.beginUndoGroup("Antigravity Mask Splitter");
            try {
                var numMasks = maskGroup.numProperties;
                var mode = radIsolate.value ? "isolate" : "crop";

                for (var i = 1; i <= numMasks; i++) {
                    var maskProp = maskGroup.property(i);
                    if (!maskProp) continue;
                    var maskName = maskProp.name;

                    var dup = layer.duplicate();
                    dup.name = layer.name + " [" + maskName + "]";

                    // Isolate mask i on the duplicated layer by removing all other masks
                    var dupMaskGroup = dup.property("ADBE Mask Parade");
                    if (dupMaskGroup) {
                        for (var j = dupMaskGroup.numProperties; j >= 1; j--) {
                            if (j !== i) {
                                dupMaskGroup.property(j).remove();
                            }
                        }
                    }

                    // Get the bounding box of the remaining mask
                    var isolatedMask = dupMaskGroup.property(1);
                    if (!isolatedMask) continue;

                    var maskPathProp = isolatedMask.maskShape;
                    if (!maskPathProp) continue;

                    var maskPath = maskPathProp.value;
                    if (!maskPath) continue;

                    var vertices = maskPath.vertices;
                    if (!vertices || vertices.length === 0) {
                        // Empty mask path, skip cropping
                        continue;
                    }

                    // Find mask bounding box in local layer coordinates
                    var minX = Infinity, maxX = -Infinity;
                    var minY = Infinity, maxY = -Infinity;
                    for (var k = 0; k < vertices.length; k++) {
                        var pt = vertices[k];
                        if (pt[0] < minX) minX = pt[0];
                        if (pt[0] > maxX) maxX = pt[0];
                        if (pt[1] < minY) minY = pt[1];
                        if (pt[1] > maxY) maxY = pt[1];
                    }

                    var w = maxX - minX;
                    var h = maxY - minY;
                    var centerAP = [minX + w/2, minY + h/2];

                    if (mode === "isolate") {
                        // Center anchor point of the duplicate layer safely without pre-composing
                        setAnchorPointAndKeepPosition(dup, centerAP);
                    } else {
                        // Pre-compose the duplicate layer (move all attributes)
                        var origIndex = dup.index;
                        var newComp = comp.layers.precompose([origIndex], dup.name, true);
                        if (!newComp) continue;

                        var preCompLayer = comp.layer(origIndex);
                        var innerLayer = newComp.layer(1);
                        if (!preCompLayer || !innerLayer) continue;

                        // Find mask bounding box in pre-comp space
                        var cMinX = Infinity, cMaxX = -Infinity;
                        var cMinY = Infinity, cMaxY = -Infinity;

                        for (var k = 0; k < vertices.length; k++) {
                            var ptInComp = localToComp2D(innerLayer, vertices[k]);
                            if (ptInComp[0] < cMinX) cMinX = ptInComp[0];
                            if (ptInComp[0] > cMaxX) cMaxX = ptInComp[0];
                            if (ptInComp[1] < cMinY) cMinY = ptInComp[1];
                            if (ptInComp[1] > cMaxY) cMaxY = ptInComp[1];
                        }

                        var cropW = Math.max(1, Math.round(cMaxX - cMinX));
                        var cropH = Math.max(1, Math.round(cMaxY - cMinY));

                        // Resize the pre-composition
                        newComp.width = cropW;
                        newComp.height = cropH;

                        // Shift layer inside pre-comp to match new cropped coordinate space
                        var innerPos = getLayerPosition(innerLayer);
                        setLayerPosition(innerLayer, [
                            innerPos[0] - cMinX,
                            innerPos[1] - cMinY,
                            innerPos.length > 2 ? innerPos[2] : 0
                        ]);

                        // Re-align the pre-comp layer in the parent composition
                        setLayerAnchorPoint(preCompLayer, [cropW / 2, cropH / 2]);
                        setLayerPosition(preCompLayer, [
                            cMinX + cropW / 2,
                            cMinY + cropH / 2,
                            0
                        ]);
                    }
                }

                // Turn off visibility of original source layer
                layer.enabled = false;

            } catch (err) {
                alert("An error occurred: " + err.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        if (win instanceof Window) {
            win.center();
            win.show();
        } else {
            win.layout.layout(true);
        }
    }

    // Helper: Safely get Position value (handles separated dimensions)
    function getLayerPosition(layer) {
        var transform = layer.transform;
        if (!transform) return [0, 0, 0];
        var posProp = transform.position;
        if (!posProp) return [0, 0, 0];
        if (posProp.dimensionsSeparated) {
            var x = transform.xPosition ? transform.xPosition.value : 0;
            var y = transform.yPosition ? transform.yPosition.value : 0;
            var z = (transform.zPosition && layer.threeDLayer) ? transform.zPosition.value : 0;
            return [x, y, z];
        }
        return posProp.value;
    }

    // Helper: Safely set Position value (handles separated dimensions)
    function setLayerPosition(layer, val) {
        var transform = layer.transform;
        if (!transform) return;
        var posProp = transform.position;
        if (!posProp) return;
        if (posProp.dimensionsSeparated) {
            if (transform.xPosition) transform.xPosition.setValue(val[0]);
            if (transform.yPosition) transform.yPosition.setValue(val[1]);
            if (transform.zPosition && val.length > 2 && layer.threeDLayer) {
                transform.zPosition.setValue(val[2]);
            }
        } else {
            posProp.setValue(val);
        }
    }

    // Helper: Safely get Anchor Point value
    function getLayerAnchorPoint(layer) {
        var transform = layer.transform;
        if (!transform || !transform.anchorPoint) return [0, 0, 0];
        return transform.anchorPoint.value;
    }

    // Helper: Safely set Anchor Point value
    function setLayerAnchorPoint(layer, val) {
        var transform = layer.transform;
        if (!transform || !transform.anchorPoint) return;
        transform.anchorPoint.setValue(val);
    }

    // Helper: Safely get Scale value
    function getLayerScale(layer) {
        var transform = layer.transform;
        if (!transform || !transform.scale) return [100, 100, 100];
        return transform.scale.value;
    }

    // Helper: Safely get Rotation value (handles 2D/3D layers)
    function getLayerRotation(layer) {
        var transform = layer.transform;
        if (!transform) return 0;
        if (layer.threeDLayer) {
            var zRot = transform.zRotation || transform.rotation;
            return zRot ? zRot.value : 0;
        }
        var rot = transform.rotation;
        return rot ? rot.value : 0;
    }

    // Helper: Converts local layer coordinates to comp space
    function localToComp2D(layer, localPoint) {
        var ap = getLayerAnchorPoint(layer);
        var pos = getLayerPosition(layer);
        var scale = getLayerScale(layer);
        var rotation = getLayerRotation(layer);

        var x = localPoint[0] - ap[0];
        var y = localPoint[1] - ap[1];

        x *= scale[0] / 100;
        y *= scale[1] / 100;

        var rad = rotation * Math.PI / 180;
        var rx = x * Math.cos(rad) - y * Math.sin(rad);
        var ry = x * Math.sin(rad) + y * Math.cos(rad);

        return [rx + pos[0], ry + pos[1]];
    }

    // Helper: Safely updates anchor point while maintaining visual layer positioning
    function setAnchorPointAndKeepPosition(layer, newAP) {
        var oldAP = getLayerAnchorPoint(layer);
        var oldPos = getLayerPosition(layer);
        var scale = getLayerScale(layer);
        var rotation = getLayerRotation(layer);

        var dx = newAP[0] - oldAP[0];
        var dy = newAP[1] - oldAP[1];

        var sx = dx * (scale[0] / 100);
        var sy = dy * (scale[1] / 100);

        var rad = rotation * Math.PI / 180;
        var rx = sx * Math.cos(rad) - sy * Math.sin(rad);
        var ry = sx * Math.sin(rad) + sy * Math.cos(rad);

        setLayerAnchorPoint(layer, newAP);
        setLayerPosition(layer, [
            oldPos[0] + rx,
            oldPos[1] + ry,
            oldPos.length > 2 ? oldPos[2] : 0
        ]);
    }

    showUI(this);
})(this);