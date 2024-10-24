/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable dot-notation */
/* eslint-disable @typescript-eslint/no-shadow */
import {LOGGER} from '../Logger/types';
import {getTestUtilsWebex} from '../common/testUtil';
import {HTTP_METHODS, SORT, SORT_BY, WebexRequestPayload} from '../common/types';
import {CallHistory, createCallHistoryClient} from './CallHistory';
import {ICallHistory} from './types';
import {
  sortedCallHistory,
  mockCallHistoryBody,
  MOCK_SESSION_EVENT,
  MOCK_SESSION_EVENT_LEGACY,
  MOCK_SESSION_EVENT_VIEWED,
  MOCK_UPDATE_MISSED_CALL_RESPONSE,
  janusSetReadStateUrl,
  ERROR_DETAILS_401,
  ERROR_DETAILS_400,
} from './callHistoryFixtures';
import {
  COMMON_EVENT_KEYS,
  CallSessionEvent,
  CallSessionViewedEvent,
  MOBIUS_EVENT_KEYS,
} from '../Events/types';
import {APPLICATION_JSON, CALL_HISTORY_FILE, CONTENT_TYPE} from './constants';
import * as utils from '../common/Utils';

const webex = getTestUtilsWebex();
let serviceErrorCodeHandlerSpy: jest.SpyInstance;
describe('Call history tests', () => {
  let callHistory: ICallHistory;

  beforeAll(() => {
    callHistory = new CallHistory(webex, {level: LOGGER.INFO});
  });

  it('verify successful call history case', async () => {
    const callHistoryPayload = <WebexRequestPayload>(<unknown>mockCallHistoryBody);

    webex.request.mockResolvedValue(callHistoryPayload);
    const response = await callHistory.getCallHistoryData(7, 10, SORT.DEFAULT, SORT_BY.DEFAULT);

    expect(response.statusCode).toBe(200);
    expect(response.message).toBe('SUCCESS');
  });

  it('verify bad request failed call history case', async () => {
    const failurePayload = {
      statusCode: 400,
    };
    const callHistoryPayload = <WebexRequestPayload>(<unknown>failurePayload);

    webex.request.mockRejectedValue(callHistoryPayload);
    const response = await callHistory.getCallHistoryData(7, 2000, SORT.ASC, SORT_BY.START_TIME);

    expect(response.statusCode).toBe(400);
    expect(response.message).toBe('FAILURE');
  });

  it('verify device not found call history case', async () => {
    const failurePayload = {
      statusCode: 404,
    };
    const callHistoryPayload = <WebexRequestPayload>(<unknown>failurePayload);

    webex.request.mockRejectedValue(callHistoryPayload);
    const response = await callHistory.getCallHistoryData(0, 0, SORT.ASC, SORT_BY.START_TIME);

    expect(response.statusCode).toBe(404);
    expect(response.message).toBe('FAILURE');
  });

  describe('sorting  user session response data by sortby', () => {
    it('Array should be sort.ASC by START TIME ', async () => {
      const callHistoryPayload = <WebexRequestPayload>(<unknown>mockCallHistoryBody);

      webex.request.mockResolvedValue(callHistoryPayload);
      const response = await callHistory.getCallHistoryData(10, 20, SORT.ASC, SORT_BY.START_TIME);

      const responseDetails = {
        statusCode: sortedCallHistory.body.statusCode,
        data: {
          userSessions: sortedCallHistory.body.userSessions,
        },
        message: 'SUCCESS',
      };

      expect(response).toEqual(responseDetails);
    });
  });

  describe('Call History Session Event test', () => {
    const mockOn = webex.internal.mercury.on;
    let callHistory: ICallHistory;

    beforeEach(() => {
      callHistory = createCallHistoryClient(webex, {level: LOGGER.INFO});
    });

    it('verify the recent user session event ', (done) => {
      callHistory.on(
        COMMON_EVENT_KEYS.CALL_HISTORY_USER_SESSION_INFO,
        (event: CallSessionEvent) => {
          expect(event.data).toEqual(MOCK_SESSION_EVENT.data);
          done();
        }
      );

      expect(mockOn.mock.calls[0][0]).toEqual(MOBIUS_EVENT_KEYS.CALL_SESSION_EVENT_INCLUSIVE);
      const callSessionCallback = mockOn.mock.calls[0][1];

      callSessionCallback(MOCK_SESSION_EVENT);
    });

    it('verify the user session event received for locus calls', (done) => {
      callHistory.on(
        COMMON_EVENT_KEYS.CALL_HISTORY_USER_SESSION_INFO,
        (event: CallSessionEvent) => {
          expect(event.data).toEqual(MOCK_SESSION_EVENT_LEGACY.data);
          done();
        }
      );

      expect(mockOn.mock.calls[1][0]).toEqual(MOBIUS_EVENT_KEYS.CALL_SESSION_EVENT_LEGACY);
      const callSessionCallback = mockOn.mock.calls[1][1];

      callSessionCallback(MOCK_SESSION_EVENT_LEGACY);
    });

    it('verify the user viewed session event for missed calls update', async () => {
      await new Promise<void>((resolve) => {
        callHistory.on(
          COMMON_EVENT_KEYS.CALL_HISTORY_USER_VIEWED_SESSIONS,
          (event: CallSessionViewedEvent) => {
            expect(event.data).toEqual(MOCK_SESSION_EVENT_VIEWED.data);
            resolve();
          }
        );

        expect(mockOn.mock.calls[2][0]).toEqual(MOBIUS_EVENT_KEYS.CALL_SESSION_EVENT_VIEWED);
        const callSessionCallback = mockOn.mock.calls[2][1];

        callSessionCallback(MOCK_SESSION_EVENT_VIEWED);
      });
    });
  });

  describe('Update missed calls test', () => {
    const methodDetails = {
      file: CALL_HISTORY_FILE,
      method: 'updateMissedCalls',
    };
    afterEach(() => {
      jest.clearAllMocks();
    });
    beforeEach(async () => {
      serviceErrorCodeHandlerSpy = jest.spyOn(utils, 'serviceErrorCodeHandler');
      global.fetch = jest.fn(() =>
        Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve(MOCK_UPDATE_MISSED_CALL_RESPONSE),
        })
      ) as jest.Mock;
    });

    it('successfully updates missed calls', async () => {
      const endTimeSessionIds = [{endTime: '1234568', sessionId: '123'}];
      const response = await callHistory.updateMissedCalls(endTimeSessionIds);
      const convertedEndTimeSessionIds = endTimeSessionIds.map((session) => ({
        ...session,
        endTime: new Date(session.endTime).getTime(),
      }));
      expect(response.statusCode).toEqual(200);
      expect(response).toEqual(MOCK_UPDATE_MISSED_CALL_RESPONSE);
      expect(global.fetch).toBeCalledOnceWith(janusSetReadStateUrl, {
        method: HTTP_METHODS.POST,
        headers: {
          [CONTENT_TYPE]: APPLICATION_JSON,
          Authorization: await webex.credentials.getUserToken(),
        },
        body: JSON.stringify({endTimeSessionIds: convertedEndTimeSessionIds}),
      });
    });

    it('Error: updateMissedCalls throw 400 error', async () => {
      const endTimeSessionIds = [];
      global.fetch = jest.fn(() =>
        Promise.resolve({
          status: 400,
          ok: false,
        })
      ) as jest.Mock;
      const response = await callHistory.updateMissedCalls(endTimeSessionIds);
      const convertedEndTimeSessionIds = endTimeSessionIds.map((session) => ({
        ...session,
        endTime: new Date(session.endTime).getTime(),
      }));
      expect(response).toStrictEqual(ERROR_DETAILS_400);
      expect(response.statusCode).toBe(400);
      expect(global.fetch).toBeCalledOnceWith(janusSetReadStateUrl, {
        method: HTTP_METHODS.POST,
        headers: {
          [CONTENT_TYPE]: APPLICATION_JSON,
          Authorization: await webex.credentials.getUserToken(),
        },
        body: JSON.stringify({endTimeSessionIds: convertedEndTimeSessionIds}),
      });
      expect(serviceErrorCodeHandlerSpy).toBeCalledOnceWith(
        {
          statusCode: 400,
        },
        methodDetails
      );
    });

    it('Error: updateMissedCalls throw 401 error', async () => {
      const endTimeSessionIds = [];
      global.fetch = jest.fn(() =>
        Promise.resolve({
          status: 401,
          ok: false,
        })
      ) as jest.Mock;

      const response = await callHistory.updateMissedCalls(endTimeSessionIds);
      const convertedEndTimeSessionIds = endTimeSessionIds.map((session) => ({
        ...session,
        endTime: new Date(session.endTime).getTime(),
      }));
      expect(response).toStrictEqual(ERROR_DETAILS_401);
      expect(response.statusCode).toBe(401);
      expect(global.fetch).toBeCalledOnceWith(janusSetReadStateUrl, {
        method: HTTP_METHODS.POST,
        headers: {
          [CONTENT_TYPE]: APPLICATION_JSON,
          Authorization: await webex.credentials.getUserToken(),
        },
        body: JSON.stringify({endTimeSessionIds: convertedEndTimeSessionIds}),
      });
      expect(serviceErrorCodeHandlerSpy).toBeCalledOnceWith(
        {
          statusCode: 401,
        },
        methodDetails
      );
    });
  });
});
