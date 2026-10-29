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

import DVBErrors from '../vo/DVBErrors.js';
import MetricsReportingEvents from '../MetricsReportingEvents.js';
import FactoryMaker from '../../../core/FactoryMaker.js';

function DVBErrorsTranslator(config) {

    config = config || {};
    let instance,
        mpd,
        corruptMediaReported = false;
    const eventBus = config.eventBus;
    const dashMetrics = config.dashMetrics;
    const metricsConstants = config.metricsConstants;
    //MediaPlayerEvents have been added to Events in MediaPlayer class
    const Events = config.events;

    function report(vo) {
        let o = new DVBErrors();

        if (!mpd) {
            return;
        }

        for (const key in vo) {
            if (vo.hasOwnProperty(key)) {
                o[key] = vo[key];
            }
        }

        if (!o.mpdurl) {
            o.mpdurl = mpd.originalUrl || mpd.url;
        }

        if (!o.terror) {
            o.terror = new Date();
        }

        dashMetrics.addDVBErrors(o);
    }

    function onManifestUpdate(e) {
        if (e.error) {
            return;
        }

        mpd = e.manifest;
    }

    function onServiceLocationChanged() {
        // ORB: Triggered in BlackListController.js when blacklist is changed, this is not
        // the same as base URL changed, as sometimes there's only 1 base URL. Disabled
        // for now as messes up HbbTV test results

        //report({
        //    errorcode: DVBErrors.BASE_URL_CHANGED,
        //    servicelocation: e.entry
        //});
    }

    function onBecameReporter() {
        report({
            errorcode: DVBErrors.BECAME_REPORTER,
            servicelocation: _getPrimaryServiceLocation()
        });
    }

    // The parser gives MPD.BaseURL as an array; use the serviceLocation of the highest priority
    // (lowest dvb:priority, default 1) BaseURL
    function _getPrimaryServiceLocation() {
        const baseUrls = mpd && mpd.BaseURL ? [].concat(mpd.BaseURL) : [];
        const priorityOf = (baseUrl) => {
            const priority = parseInt(baseUrl['dvb:priority'], 10);
            return isNaN(priority) ? 1 : priority;
        };
        const primary = baseUrls
            .filter((baseUrl) => baseUrl && baseUrl.serviceLocation !== undefined)
            .sort((a, b) => priorityOf(a) - priorityOf(b))[0];
        return primary ? primary.serviceLocation : undefined;
    }

    function handleHttpMetric(vo) {
        if ((vo.responsecode === 0) || // connection failure - unknown
            (vo.responsecode == null) || // Generated on .catch() and when uninitialized
            (vo.responsecode >= 400) || // HTTP error status code
            (vo.responsecode < 100) || // unknown status codes
            (vo.responsecode >= 600)) { // unknown status codes
            const ipaddress = _resolveIpAddress(vo.url);
            let repObj = {
                errorcode:          vo.responsecode,
                url:                vo.url,
                terror:             vo.tresponse,
                servicelocation:    vo._serviceLocation,
                ipaddress:          ipaddress
            };

            if (vo.responsecode === 0) {
                repObj.errorcode = DVBErrors.DNS_RESOLUTION_FAILED;
            }
            if (vo.responsecode == null) {
                repObj.errorcode = DVBErrors.CONNECTION_REFUSED;
            }

            if (vo.responsecode == 403) {
                let repObj2 = {
                    errorcode:          DVBErrors.BASE_URL_CHANGED,
                    url:                vo.url,
                    terror:             vo.tresponse,
                    servicelocation:    vo._serviceLocation,
                    ipaddress:          ipaddress
                };
                report(repObj2);
            }

            report(repObj);
        }
    }

    function _resolveIpAddress(url) {
        const parsed = new URL(url, document.baseURI);
        return (window.orbNetwork ? window.orbNetwork.resolveHostAddress(parsed.hostname) : undefined);
    }

    function _isIsoBmff(request) {
        const representation = request.representation || {};
        const mimeType = representation.mimeType || (representation.mediaInfo && representation.mediaInfo.mimeType) || '';
        return /mp4/i.test(mimeType);
    }

    // ORB: A SourceBuffer error is only raised by the MSE append error algorithm, i.e. when the
    // byte stream could not be parsed. For ISO BMFF segments this is "M00" (TS 103 285 10.12.3).
    // The decode error the browser raises on the media element afterwards is the same incident,
    // so it must not be reported again as "M01" (DASH-ERRORREP0008).
    function onSourceBufferError(e) {
        const request = e && e.lastRequestAppended;
        if (!request || !request.url) {
            return;
        }

        corruptMediaReported = true;
        report({
            errorcode: _isIsoBmff(request) ? DVBErrors.CORRUPT_MEDIA_ISOBMFF : DVBErrors.CORRUPT_MEDIA_OTHER,
            url: request.url,
            servicelocation: request.serviceLocation,
            ipaddress: _resolveIpAddress(request.url)
        });
    }

    // ORB: A downloadable font (urn:dvb:dash:fontdownload:2014) failed to load. FontFace.load() does
    // not say why, so request the font once more to classify the failure (DASH-ERRORREP0027/28/29):
    // an HTTP error is reported with its status code, a connection failure as for media requests,
    // and a font that downloads but cannot be loaded as corrupt media "M01".
    function onFontDownloadFailed(font) {
        if (!font || !font.url) {
            return;
        }

        const terror = new Date();
        const reportFontError = (errorcode) => {
            report({
                errorcode,
                url: font.url,
                terror,
                servicelocation: _getPrimaryServiceLocation(),
                ipaddress: _resolveIpAddress(font.url)
            });
        };

        const xhr = new XMLHttpRequest();
        xhr.open('GET', font.url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onloadend = () => {
            const status = xhr.status;
            if (status === 0) {
                reportFontError(DVBErrors.DNS_RESOLUTION_FAILED);
            } else if (status < 200 || status >= 400) {
                reportFontError(status);
            } else {
                reportFontError(DVBErrors.CORRUPT_MEDIA_OTHER);
            }
        };
        xhr.send();
    }

    function onMetricEvent(e) {
        switch (e.metric) {
            case metricsConstants.HTTP_REQUEST:
                handleHttpMetric(e.value);
                break;
            default:
                break;
        }
    }

    function onPlaybackError(e) {
        let reason = e.error ? e.error.code : 0;
        let errorcode;
        // Only the media element error directly following a failed append belongs to it
        const followsCorruptMediaReport = corruptMediaReported;
        corruptMediaReported = false;

        switch (reason) {
            // ORB: Disabled as not expected by HbbTV tests
            //case MediaError.MEDIA_ERR_NETWORK:
            //    errorcode = DVBErrors.CONNECTION_ERROR;
            //    break;
            case MediaError.MEDIA_ERR_DECODE:
                if (followsCorruptMediaReport) {
                    return;
                }
                errorcode = DVBErrors.CORRUPT_MEDIA_OTHER;
                break;
            default:
                return;
        }

        report({
            errorcode: errorcode
        });
    }

    function initialize() {
        eventBus.on(Events.MANIFEST_UPDATED, onManifestUpdate, instance);
        eventBus.on(
            Events.SERVICE_LOCATION_BASE_URL_BLACKLIST_CHANGED,
            onServiceLocationChanged,
            instance
        );
        eventBus.on(Events.METRIC_ADDED, onMetricEvent, instance);
        eventBus.on(Events.METRIC_UPDATED, onMetricEvent, instance);
        eventBus.on(Events.PLAYBACK_ERROR, onPlaybackError, instance);
        eventBus.on(Events.SOURCE_BUFFER_ERROR, onSourceBufferError, instance);
        eventBus.on(Events.DVB_FONT_DOWNLOAD_FAILED, onFontDownloadFailed, instance);
        eventBus.on(
            MetricsReportingEvents.BECAME_REPORTING_PLAYER,
            onBecameReporter,
            instance
        );
    }

    function reset() {
        eventBus.off(Events.MANIFEST_UPDATED, onManifestUpdate, instance);
        eventBus.off(
            Events.SERVICE_LOCATION_BASE_URL_BLACKLIST_CHANGED,
            onServiceLocationChanged,
            instance
        );
        eventBus.off(Events.METRIC_ADDED, onMetricEvent, instance);
        eventBus.off(Events.METRIC_UPDATED, onMetricEvent, instance);
        eventBus.off(Events.PLAYBACK_ERROR, onPlaybackError, instance);
        eventBus.off(Events.SOURCE_BUFFER_ERROR, onSourceBufferError, instance);
        eventBus.off(Events.DVB_FONT_DOWNLOAD_FAILED, onFontDownloadFailed, instance);
        eventBus.off(
            MetricsReportingEvents.BECAME_REPORTING_PLAYER,
            onBecameReporter,
            instance
        );
        corruptMediaReported = false;
    }

    instance = {
        initialize,
        reset
    };

    return instance;
}

DVBErrorsTranslator.__dashjs_factory_name = 'DVBErrorsTranslator';
export default FactoryMaker.getSingletonFactory(DVBErrorsTranslator);
