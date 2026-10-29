import TimeSyncController from '../../../../src/streaming/controllers/TimeSyncController.js';
import Events from '../../../../src/core/events/Events.js';
import EventBus from '../../../../src/core/EventBus.js';
import Settings from '../../../../src/core/Settings.js';
import ErrorHandlerMock from '../../mocks/ErrorHandlerMock.js';

import {expect} from 'chai';
const context = {};
const eventBus = EventBus(context).getInstance();
const errHandlerMock = new ErrorHandlerMock();

import {fakeXhr} from 'nise';

describe('TimeSyncController', function () {
    let timeSyncController;
    let settings = Settings(context).getInstance();

    beforeEach(function () {
        window.XMLHttpRequest = fakeXhr.useFakeXMLHttpRequest();

        this.requests = [];
        window.XMLHttpRequest.onCreate = function (xhr) {
            this.requests.push(xhr);
        }.bind(this);

        timeSyncController = TimeSyncController(context).getInstance();
        timeSyncController.setConfig({
            settings,
            errHandler: errHandlerMock
        });
    });


    afterEach(function () {
        window.XMLHttpRequest.restore();
        timeSyncController.reset();
        timeSyncController = null;
        settings.reset();
    });

    it('should trigger TIME_SYNCHRONIZATION_COMPLETED when time source is not defined and no date header is used', function (done) {
        function onCompleted() {
            eventBus.off(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
            done();
        }

        eventBus.on(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
        settings.update({ streaming: { utcSynchronization: {useManifestDateHeaderTimeSource: false }} });
        timeSyncController.initialize();
        timeSyncController.attemptSync([]);
    });

    it('should trigger UPDATE_TIME_SYNC_OFFSET when time source is not defined and no date header is used', function (done) {
        function onCompleted(e) {
            eventBus.off(Events.UPDATE_TIME_SYNC_OFFSET, onCompleted, this);
            check(done, function () {
                expect(e.offset).to.be.NaN
            });
        }

        eventBus.on(Events.UPDATE_TIME_SYNC_OFFSET, onCompleted, this);
        settings.update({ streaming: { utcSynchronization: {useManifestDateHeaderTimeSource: false }} });
        timeSyncController.initialize();
        timeSyncController.attemptSync([], true);
    });


    it('should synchronize time when time source is defined', function (done) {
        let self = this;
        let date = new Date();

        function onCompleted() {
            eventBus.off(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
            done();
        }

        eventBus.on(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
        timeSyncController.initialize();
        timeSyncController.attemptSync([{
            schemeIdUri: 'urn:mpeg:dash:utc:http-xsdate:2014',
            value: 'https://time.akamai.com/?iso'
        }], true);

        // simulate a response
        self.requests[0].respond(200, {
            'Content-Type': 'text/plain; charset=ISO-8859-1'
        }, date.toString());
    });

    it('should calculate offset when time source is defined', function (done) {
        let self = this;
        let date = new Date();

        function onCompleted(e) {
            eventBus.off(Events.UPDATE_TIME_SYNC_OFFSET, onCompleted, this);
            check(done, function () {
                expect(e.offset).to.be.a('number');
            });
        }

        eventBus.on(Events.UPDATE_TIME_SYNC_OFFSET, onCompleted, this);
        timeSyncController.initialize();
        timeSyncController.attemptSync([{
            schemeIdUri: 'urn:mpeg:dash:utc:http-xsdate:2014',
            value: 'https://time.akamai.com/?iso'
        }], true);

        // simulate a response
        self.requests[0].respond(200, {
            'Content-Type': 'text/plain; charset=ISO-8859-1'
        }, date.toString());
    });

    describe('static MPD', function () {
        afterEach(function () {
            errHandlerMock.reset();
        });

        it('should not make a request and complete immediately when the MPD has no UTCTiming element', function (done) {
            const self = this;
            function onCompleted() {
                eventBus.off(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
                check(done, function () {
                    expect(self.requests.length).to.equal(0);
                });
            }

            eventBus.on(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
            timeSyncController.initialize();
            timeSyncController.attemptSync([], false);
        });

        it('should request the UTCTiming source signalled in the MPD (http-head)', function (done) {
            const self = this;
            function onCompleted() {
                eventBus.off(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
                check(done, function () {
                    expect(self.requests[0].method).to.equal('HEAD');
                    expect(self.requests[0].url).to.equal('http://time.test/timeserver.php?time=1');
                });
            }

            eventBus.on(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
            timeSyncController.initialize();
            timeSyncController.attemptSync([{
                schemeIdUri: 'urn:mpeg:dash:utc:http-head:2014',
                value: 'http://time.test/timeserver.php?time=1'
            }], false);

            expect(self.requests.length).to.equal(1);
            self.requests[0].respond(200, { 'Date': new Date().toUTCString() }, '');
        });

        it('should request the UTCTiming source signalled in the MPD (http-xsdate)', function (done) {
            const self = this;
            function onCompleted() {
                eventBus.off(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
                check(done, function () {
                    expect(self.requests[0].method).to.equal('GET');
                    expect(self.requests[0].url).to.equal('http://time.test/timeserver.php?time=1');
                });
            }

            eventBus.on(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
            timeSyncController.initialize();
            timeSyncController.attemptSync([{
                schemeIdUri: 'urn:mpeg:dash:utc:http-xsdate:2014',
                value: 'http://time.test/timeserver.php?time=1'
            }], false);

            expect(self.requests.length).to.equal(1);
            self.requests[0].respond(200, { 'Content-Type': 'text/plain' }, new Date().toISOString());
        });

        it('should not raise a time sync error when the sync of a static MPD fails', function (done) {
            const self = this;
            function onCompleted() {
                eventBus.off(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
                check(done, function () {
                    expect(errHandlerMock.errorCode).to.be.undefined;
                });
            }

            eventBus.on(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
            settings.update({ streaming: { utcSynchronization: { useManifestDateHeaderTimeSource: false } } });
            timeSyncController.initialize();
            timeSyncController.attemptSync([{
                schemeIdUri: 'urn:mpeg:dash:utc:http-xsdate:2014',
                value: 'http://time.test/timeserver.php?time=1'
            }], false);

            self.requests[0].respond(404, {}, '');
        });

        it('should still raise a time sync error when the sync of a dynamic MPD fails', function (done) {
            const self = this;
            function onCompleted() {
                eventBus.off(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
                check(done, function () {
                    expect(errHandlerMock.errorCode).to.equal(16);
                });
            }

            eventBus.on(Events.TIME_SYNCHRONIZATION_COMPLETED, onCompleted, this);
            settings.update({ streaming: { utcSynchronization: { useManifestDateHeaderTimeSource: false } } });
            timeSyncController.initialize();
            timeSyncController.attemptSync([{
                schemeIdUri: 'urn:mpeg:dash:utc:http-xsdate:2014',
                value: 'http://time.test/timeserver.php?time=1'
            }], true);

            self.requests[0].respond(404, {}, '');
        });
    });

});

function check(done, f) {
    try {
        f();
        done();
    } catch (e) {
        done(e);
    }
}
