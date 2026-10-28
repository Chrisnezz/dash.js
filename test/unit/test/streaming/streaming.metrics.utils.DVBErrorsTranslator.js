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
});
