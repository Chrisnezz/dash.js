/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Dash Industry Forum.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  * Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  * Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */
import FactoryMaker from '../../core/FactoryMaker.js';
import DashConstants from '../constants/DashConstants.js';
import ObjectIron from './objectiron.js';
import DurationMatcher from './matchers/DurationMatcher.js';
import DateTimeMatcher from './matchers/DateTimeMatcher.js';
import NumericMatcher from './matchers/NumericMatcher.js';
import LangMatcher from './matchers/LangMatcher.js';
import RepresentationBaseValuesMap from './maps/RepresentationBaseValuesMap.js';
import SegmentValuesMap from './maps/SegmentValuesMap.js';
import BASE64 from '../../../externals/base64.js';
import { parseXml as cmlParseXml } from '@svta/cml-xml';

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

function _isXmlnsAttribute(name) {
    return name === 'xmlns' || name.startsWith('xmlns:');
}

function _getTextContent(node) {
    if (node.nodeName === '#text' || node.nodeName === '#cdata') {
        return node.nodeValue || '';
    }
    return node.childNodes.map(_getTextContent).join('');
}

function _compare(a, b) {
    return (a > b) - (a < b);
}

function _encodeC14nAttribute(value) {
    return value.replace(/[&<"\x09\x0A\x0D]/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '"': '&quot;',
        '\x09': '&#x9;',
        '\x0A': '&#xA;',
        '\x0D': '&#xD;'
    }[c]));
}

function _encodeC14nText(value) {
    return value.replace(/[&<>\x0D]/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '\x0D': '&#xD;'
    }[c]));
}

/**
 * Canonical XML (C14N) serialization of a raw (not yet processed) cml-xml node.
 * Default namespace declarations are intentionally left out.
 * @param {object} node
 * @param {object} inScope - prefix -> namespace URI map in scope for this node
 * @param {object} rendered - prefix -> namespace URI map already output by the ancestors
 * @param {boolean} isRoot
 * @return {string}
 * @private
 */
function _toXmlC14n(node, inScope, rendered, isRoot) {
    if (node.nodeName === '#text' || node.nodeName === '#cdata') {
        return _encodeC14nText(node.nodeValue || '');
    }
    if (node.nodeName.startsWith('#')) {
        return '';
    }

    const ownNamespaces = [];
    const attributes = [];
    const ownScope = { ...inScope };
    const declared = [];

    Object.keys(node.attributes).forEach((name) => {
        if (_isXmlnsAttribute(name)) {
            if (name !== 'xmlns') {
                declared.push(name.slice(6));
            }
        } else {
            attributes.push(name);
        }
    });

    const candidates = isRoot ? Object.keys(ownScope).filter(p => p) : declared;
    candidates.forEach((prefix) => {
        if (rendered[prefix] !== ownScope[prefix]) {
            ownNamespaces.push(prefix);
        }
    });

    const namespaceOf = (attrName) => {
        const p = attrName.indexOf(':');
        if (p === -1) {
            return '';
        }
        const prefix = attrName.slice(0, p);
        return prefix === 'xml' ? XML_NAMESPACE : (ownScope[prefix] || '');
    };
    const localOf = (attrName) => attrName.slice(attrName.indexOf(':') + 1);

    ownNamespaces.sort(_compare);
    attributes.sort((a, b) => _compare(namespaceOf(a), namespaceOf(b)) || _compare(localOf(a), localOf(b)));

    const printed = ownNamespaces.map(prefix => ` xmlns:${prefix}="${_encodeC14nAttribute(ownScope[prefix])}"`).join('') +
        attributes.map(name => ` ${name}="${_encodeC14nAttribute(node.attributes[name])}"`).join('');

    const newRendered = { ...rendered };
    ownNamespaces.forEach((prefix) => {
        newRendered[prefix] = ownScope[prefix];
    });
    const children = node.childNodes.map(child => _toXmlC14n(child, ownScope, newRendered, false)).join('');

    return `<${node.nodeName}${printed}>${children}</${node.nodeName}>`;
}

// List of node that shall be represented as arrays
const arrayNodes = [
    DashConstants.ACCESSIBILITY,
    DashConstants.ADAPTATION_SET,
    DashConstants.ADD,
    DashConstants.AUDIO_CHANNEL_CONFIGURATION,
    DashConstants.BASE_URL,
    DashConstants.CONTENT_COMPONENT,
    DashConstants.CONTENT_PROTECTION,
    DashConstants.CONTENT_STEERING,
    DashConstants.ESSENTIAL_PROPERTY,
    DashConstants.EVENT,
    DashConstants.EVENT_STREAM,
    DashConstants.INBAND_EVENT_STREAM,
    DashConstants.LABEL,
    DashConstants.LOCATION,
    DashConstants.METRICS,
    DashConstants.PATCH_LOCATION,
    DashConstants.PERIOD,
    DashConstants.PRESELECTION,
    DashConstants.PRODUCER_REFERENCE_TIME,
    DashConstants.REMOVE,
    DashConstants.REPLACE,
    DashConstants.REPORTING,
    DashConstants.REPRESENTATION,
    DashConstants.ROLE,
    DashConstants.S,
    DashConstants.SEGMENT_SEQUENCE_PROPERTIES,
    DashConstants.SEGMENT_URL,
    DashConstants.SERVICE_DESCRIPTION,
    DashConstants.SUPPLEMENTAL_PROPERTY,
    DashConstants.UTC_TIMING,
];

function DashParser(config) {

    config = config || {};
    const context = this.context;
    const debug = config.debug;

    let instance,
        logger,
        matchers,
        objectIron;

    function setup() {
        logger = debug.getLogger(instance);
        matchers = [
            new DurationMatcher(),
            new DateTimeMatcher(),
            new NumericMatcher(),
            new LangMatcher()
        ];

        objectIron = ObjectIron(context).create({
            adaptationset: new RepresentationBaseValuesMap(),
            period: new SegmentValuesMap()
        });
    }

    function getIron() {
        return objectIron;
    }

    function parse(data) {
        let manifest;
        const startTime = window.performance.now();

        manifest = parseXml(data);

        if (!manifest || (!manifest.MPD && !manifest.Patch)) {
            throw new Error('failed to parse the manifest');
        }

        // handle full MPD and Patch ironing separately
        if (manifest.Patch) {
            manifest = manifest.Patch; // drop root reference
            // apply iron to patch operations individually
            if (manifest.add) {
                manifest.add.forEach((operand) => objectIron.run(operand));
            }
            if (manifest.replace) {
                manifest.replace.forEach((operand) => objectIron.run(operand));
            }
            // note that we don't need to iron remove as they contain no children
        } else {
            manifest = manifest.MPD; // drop root reference
            objectIron.run(manifest);
        }

        const parsedTime = window.performance.now();
        logger.info('Parsing complete: ' + (parsedTime - startTime).toPrecision(3) + 'ms');

        manifest.protocol = 'DASH';

        return manifest;
    }

    function processXml(data) {
        const xml = cmlParseXml(data);
        const root = xml.childNodes.find(child => child.nodeName === 'MPD' || child.nodeName === 'Patch') || xml.childNodes[0];

        function processNode(node, parentNamespaces) {
            // Track the namespace declarations in scope
            let namespaces = parentNamespaces;
            for (const k in node.attributes) {
                if (_isXmlnsAttribute(k)) {
                    if (namespaces === parentNamespaces) {
                        namespaces = { ...parentNamespaces };
                    }
                    namespaces[k === 'xmlns' ? '' : k.slice(6)] = node.attributes[k];
                }
            }

            // org.hbbtv_DASH-131-EVENTS0120: the Event payload is the canonical XML for an empty Event,
            // the decoded bytes for base64 content, or the text content otherwise
            if (node.localName === DashConstants.EVENT && !('messageData' in node.attributes)) {
                if (!node.childNodes.length) {
                    node.messageData = _toXmlC14n(node, namespaces, {}, true);
                } else if (node.attributes.contentEncoding === 'base64') {
                    node.messageData = BASE64.decodeArray(_getTextContent(node));
                } else {
                    node.messageData = _getTextContent(node);
                }
            }

            // Convert tag name
            let p = node.nodeName.indexOf(':');
            if (p !== -1) {
                node.__prefix = node.prefix;
                node.nodeName = node.localName;
            }

            const { childNodes, attributes, nodeName } = node;
            node.tagName = nodeName;

            // Convert attributes
            for (let k in attributes) {
                let value = attributes[k];

                if (nodeName === 'S') {
                    value = parseInt(value);
                }
                else {
                    for (let i = 0, len = matchers.length; i < len; i++) {
                        const matcher = matchers[i];
                        if (matcher.test(nodeName, k, value)) {
                            value = matcher.converter(value);
                            break;
                        }
                    }
                }

                node[k] = value;

                // ORB: LangMatcher normalizes @lang to BCP-47 (e.g. "eng" -> "en"); HbbTV exposes the
                // MPD value as is (AVComponent/AudioTrack.language), so keep the original next to it.
                if (k === DashConstants.LANG && value !== attributes[k]) {
                    node[DashConstants.ORB_ORIGINAL_LANG] = attributes[k];
                }
            }

            // Convert children
            const len = childNodes?.length;

            for (let i = 0; i < len; i++) {
                const child = childNodes[i];

                if (child.nodeName === '#text') {
                    node.__text = child.nodeValue;
                    continue;
                }

                processNode(child, namespaces);

                const { nodeName } = child;

                if (Array.isArray(node[nodeName])) {
                    node[nodeName].push(child);
                }
                else if (arrayNodes.indexOf(nodeName) !== -1) {
                    if (!node[nodeName]) {
                        node[nodeName] = [];
                    }
                    node[nodeName].push(child);
                } else {
                    node[nodeName] = child;
                }
            }

            node.__children = childNodes;
        }

        processNode(root, {});

        return root;
    }

    function parseXml(data) {
        try {
            const root = processXml(data);

            return {
                [root.tagName]: root
            };
        } catch (e) {
            return null;
        }
    }

    instance = {
        getIron: getIron,
        parseXml: parseXml,
        parse: parse
    };

    setup();

    return instance;
}

DashParser.__dashjs_factory_name = 'DashParser';
export default FactoryMaker.getClassFactory(DashParser);
