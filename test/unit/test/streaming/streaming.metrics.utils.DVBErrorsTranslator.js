import DVBErrorsTranslator from '../../../../src/streaming/metrics/utils/DVBErrorsTranslator.js';
import DVBErrors from '../../../../src/streaming/metrics/vo/DVBErrors.js';
import MetricsReportingEvents from '../../../../src/streaming/metrics/MetricsReportingEvents.js';
import MetricsConstants from '../../../../src/streaming/constants/MetricsConstants.js';
import Events from '../../../../src/core/events/Events.js';
import MediaPlayerEvents from '../../../../src/streaming/MediaPlayerEvents.js';
import EventBus from '../../../../src/core/EventBus.js';

import {expect} from 'chai';
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
});
