import DVBErrorsTranslator from '../../../../src/streaming/metrics/utils/DVBErrorsTranslator.js';
import DVBErrors from '../../../../src/streaming/metrics/vo/DVBErrors.js';
import MetricsReportingEvents from '../../../../src/streaming/metrics/MetricsReportingEvents.js';
import MetricsConstants from '../../../../src/streaming/constants/MetricsConstants.js';
import Events from '../../../../src/core/events/Events.js';
import MediaPlayerEvents from '../../../../src/streaming/MediaPlayerEvents.js';
import EventBus from '../../../../src/core/EventBus.js';

import {expect} from 'chai';
import {fakeXhr} from 'nise';
import sinon from 'sinon';

describe('DVBErrorsTranslator', function () {
    let context, eventBus, translator, dashMetrics;

    function becomeReporter(baseUrl) {
        const manifest = { url: 'http://example.com/test.mpd' };
        if (baseUrl !== undefined) {
            manifest.BaseURL = baseUrl;
        }
        eventBus.trigger(Events.MANIFEST_UPDATED, { manifest });
        eventBus.trigger(MetricsReportingEvents.BECAME_REPORTING_PLAYER);
        expect(dashMetrics.addDVBErrors.calledOnce).to.be.true;
        return dashMetrics.addDVBErrors.firstCall.args[0];
    }

    beforeEach(function () {
        // DVBErrorsTranslator and EventBus are singletons per context
        context = {};
        eventBus = EventBus(context).getInstance();
        dashMetrics = { addDVBErrors: sinon.spy() };
        translator = DVBErrorsTranslator(context).getInstance({
            eventBus,
            dashMetrics,
            metricsConstants: MetricsConstants,
            events: Object.assign({}, Events, MediaPlayerEvents)
        });
        translator.initialize();
    });

    afterEach(function () {
        translator.reset();
    });

    describe('S00 (became reporting player) report', function () {
        it('should report the serviceLocation of a single BaseURL parsed as an array', function () {
            const report = becomeReporter([{ __text: 'http://a.example.com/', serviceLocation: 'hbbtvTest' }]);

            expect(report.errorcode).to.equal(DVBErrors.BECAME_REPORTER);
            expect(report.servicelocation).to.equal('hbbtvTest');
            expect(report.mpdurl).to.equal('http://example.com/test.mpd');
        });

        it('should report the serviceLocation of the BaseURL with the highest priority (lowest dvb:priority)', function () {
            const report = becomeReporter([
                { __text: 'http://b.example.com/', serviceLocation: 'B', 'dvb:priority': '2' },
                { __text: 'http://a.example.com/', serviceLocation: 'A', 'dvb:priority': '1' }
            ]);

            expect(report.servicelocation).to.equal('A');
        });

        it('should treat a BaseURL without dvb:priority as priority 1', function () {
            const report = becomeReporter([
                { __text: 'http://b.example.com/', serviceLocation: 'B', 'dvb:priority': '2' },
                { __text: 'http://a.example.com/', serviceLocation: 'A' }
            ]);

            expect(report.servicelocation).to.equal('A');
        });

        it('should accept a single BaseURL object', function () {
            const report = becomeReporter({ __text: 'http://a.example.com/', serviceLocation: 'hbbtvTest' });

            expect(report.servicelocation).to.equal('hbbtvTest');
        });

        it('should not set servicelocation when no BaseURL has a serviceLocation', function () {
            expect(becomeReporter([{ __text: 'http://a.example.com/' }]).servicelocation).to.not.be.ok;
        });

        it('should not set servicelocation when the MPD has no BaseURL', function () {
            expect(becomeReporter(undefined).servicelocation).to.not.be.ok;
        });
    });

    describe('corrupt media (M00/M01) reports', function () {
        const segmentUrl = 'http://a.example.com/Vseg_3.m4s';

        function appendFails(representation) {
            eventBus.trigger(Events.SOURCE_BUFFER_ERROR, {
                error: {},
                lastRequestAppended: { url: segmentUrl, serviceLocation: 'hbbtvTest', representation }
            });
        }

        function decodeError() {
            eventBus.trigger(MediaPlayerEvents.PLAYBACK_ERROR, { error: { code: MediaError.MEDIA_ERR_DECODE } });
        }

        beforeEach(function () {
            eventBus.trigger(Events.MANIFEST_UPDATED, { manifest: { url: 'http://example.com/test.mpd' } });
        });

        it('should report M00 with url and servicelocation when an ISO BMFF segment cannot be appended', function () {
            appendFails({ mimeType: 'video/mp4' });

            expect(dashMetrics.addDVBErrors.calledOnce).to.be.true;
            const report = dashMetrics.addDVBErrors.firstCall.args[0];
            expect(report.errorcode).to.equal(DVBErrors.CORRUPT_MEDIA_ISOBMFF);
            expect(report.url).to.equal(segmentUrl);
            expect(report.servicelocation).to.equal('hbbtvTest');
        });

        it('should use the AdaptationSet mimeType when the Representation has none', function () {
            appendFails({ mimeType: null, mediaInfo: { mimeType: 'audio/mp4' } });

            expect(dashMetrics.addDVBErrors.firstCall.args[0].errorcode).to.equal(DVBErrors.CORRUPT_MEDIA_ISOBMFF);
        });

        it('should report M01 when a non ISO BMFF segment cannot be appended', function () {
            appendFails({ mimeType: 'video/webm' });

            expect(dashMetrics.addDVBErrors.firstCall.args[0].errorcode).to.equal(DVBErrors.CORRUPT_MEDIA_OTHER);
        });

        it('should not report M01 for the decode error that follows a failed append', function () {
            appendFails({ mimeType: 'video/mp4' });
            decodeError();

            expect(dashMetrics.addDVBErrors.calledOnce).to.be.true;
            expect(dashMetrics.addDVBErrors.firstCall.args[0].errorcode).to.equal(DVBErrors.CORRUPT_MEDIA_ISOBMFF);
        });

        it('should report M01 for a decode error without a failed append', function () {
            decodeError();

            expect(dashMetrics.addDVBErrors.calledOnce).to.be.true;
            expect(dashMetrics.addDVBErrors.firstCall.args[0].errorcode).to.equal(DVBErrors.CORRUPT_MEDIA_OTHER);
        });

        it('should only suppress the first decode error after a failed append', function () {
            appendFails({ mimeType: 'video/mp4' });
            decodeError();
            decodeError();

            expect(dashMetrics.addDVBErrors.calledTwice).to.be.true;
            expect(dashMetrics.addDVBErrors.secondCall.args[0].errorcode).to.equal(DVBErrors.CORRUPT_MEDIA_OTHER);
        });

        it('should not suppress a later decode error when another media error followed the failed append', function () {
            appendFails({ mimeType: 'video/mp4' });
            eventBus.trigger(MediaPlayerEvents.PLAYBACK_ERROR, { error: { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED } });
            decodeError();

            expect(dashMetrics.addDVBErrors.calledTwice).to.be.true;
            expect(dashMetrics.addDVBErrors.secondCall.args[0].errorcode).to.equal(DVBErrors.CORRUPT_MEDIA_OTHER);
        });

        it('should ignore a SourceBuffer error without a known request', function () {
            eventBus.trigger(Events.SOURCE_BUFFER_ERROR, { error: {}, lastRequestAppended: null });

            expect(dashMetrics.addDVBErrors.called).to.be.false;
        });
    });

    describe('DVB font download failure reports', function () {
        const fontUrl = 'http://a.example.com/fonts/font.woff';
        let xhr;

        function fontDownloadFails(status) {
            eventBus.trigger(MediaPlayerEvents.DVB_FONT_DOWNLOAD_FAILED, { url: fontUrl, fontFamily: 'Hanken', isEssential: true });
            expect(xhr.requests.length).to.equal(1);
            expect(xhr.requests[0].url).to.equal(fontUrl);
            if (status === 0) {
                xhr.requests[0].error();
            } else {
                xhr.requests[0].respond(status, {}, '');
            }
            expect(dashMetrics.addDVBErrors.calledOnce).to.be.true;
            return dashMetrics.addDVBErrors.firstCall.args[0];
        }

        beforeEach(function () {
            xhr = fakeXhr.useFakeXMLHttpRequest();
            window.XMLHttpRequest = xhr;
            xhr.requests = [];
            xhr.onCreate = (request) => xhr.requests.push(request);
            eventBus.trigger(Events.MANIFEST_UPDATED, {
                manifest: { url: 'http://example.com/test.mpd', BaseURL: [{ __text: 'http://a.example.com/', serviceLocation: 'hbbtvTest' }] }
            });
        });

        afterEach(function () {
            xhr.restore();
        });

        it('should report M01 with the font url when the font downloads but cannot be loaded', function () {
            const report = fontDownloadFails(200);

            expect(report.errorcode).to.equal(DVBErrors.CORRUPT_MEDIA_OTHER);
            expect(report.url).to.equal(fontUrl);
            expect(report.servicelocation).to.equal('hbbtvTest');
        });

        it('should report the HTTP status code when the font request fails', function () {
            expect(fontDownloadFails(404).errorcode).to.equal(404);
        });

        it('should report a connection failure like a failed media request', function () {
            expect(fontDownloadFails(0).errorcode).to.equal(DVBErrors.DNS_RESOLUTION_FAILED);
        });

        it('should classify a font connection failure with the ORB connection check', function () {
            window.orbNetwork = { resolveHostAddress: () => '', resolveConnectionError: sinon.stub().returns('C01') };
            try {
                expect(fontDownloadFails(0).errorcode).to.equal('C01');
                expect(window.orbNetwork.resolveConnectionError.calledOnceWith('a.example.com', 80)).to.be.true;
            } finally {
                delete window.orbNetwork;
            }
        });
    });

    describe('connection failure (status 0) reports', function () {
        let resolveConnectionError;

        function requestFails(url, aborted = false) {
            eventBus.trigger(MediaPlayerEvents.METRIC_ADDED, {
                metric: MetricsConstants.HTTP_REQUEST,
                value: { url, responsecode: 0, tresponse: null, _serviceLocation: 'hbbtvTest', _aborted: aborted }
            });
        }

        beforeEach(function () {
            resolveConnectionError = sinon.stub().returns('C02');
            window.orbNetwork = { resolveHostAddress: () => '10.0.0.1', resolveConnectionError };
            eventBus.trigger(Events.MANIFEST_UPDATED, { manifest: { url: 'http://example.com/test.mpd' } });
        });

        afterEach(function () {
            delete window.orbNetwork;
        });

        it('should report the code from the ORB connection check with host and port', function () {
            requestFails('http://hbbtv1.test:81/DASH/seg_1.m4s');

            expect(resolveConnectionError.calledOnceWith('hbbtv1.test', 81)).to.be.true;
            const report = dashMetrics.addDVBErrors.firstCall.args[0];
            expect(report.errorcode).to.equal('C02');
            expect(report.url).to.equal('http://hbbtv1.test:81/DASH/seg_1.m4s');
            expect(report.ipaddress).to.equal('10.0.0.1');
            expect(report.servicelocation).to.equal('hbbtvTest');
        });

        it('should use the default port of the URL scheme', function () {
            requestFails('https://secure.example.com/seg_1.m4s');

            expect(resolveConnectionError.calledOnceWith('secure.example.com', 443)).to.be.true;
        });

        it('should check a host and port only once within a short time', function () {
            requestFails('http://hbbtv1.test:81/DASH/seg_1.m4s');
            requestFails('http://hbbtv1.test:81/DASH/seg_2.m4s');

            expect(resolveConnectionError.calledOnce).to.be.true;
            expect(dashMetrics.addDVBErrors.calledTwice).to.be.true;
            expect(dashMetrics.addDVBErrors.secondCall.args[0].errorcode).to.equal('C02');
        });

        it('should fall back to C00 when ORB has no connection check', function () {
            delete window.orbNetwork.resolveConnectionError;
            requestFails('http://hbbtv1.test:81/DASH/seg_1.m4s');

            expect(dashMetrics.addDVBErrors.firstCall.args[0].errorcode).to.equal(DVBErrors.DNS_RESOLUTION_FAILED);
        });

        it('should not report a request the player aborted itself', function () {
            requestFails('http://hbbtv1.test:81/DASH/seg_1.m4s', true);

            expect(resolveConnectionError.called).to.be.false;
            expect(dashMetrics.addDVBErrors.called).to.be.false;
        });
    });
});
