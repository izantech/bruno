import { useEffect } from 'react';
import { wsResponseReceived, runWsRequestEvent } from 'providers/ReduxStore/slices/collections/index';
import { useDispatch } from 'react-redux';
import { isElectron } from 'utils/common/platform';
import ipc from 'utils/common/ipc';
import { updateActiveConnectionsInStore } from 'providers/ReduxStore/slices/collections/actions';

const useWsEventListeners = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    if (!isElectron()) {
      return () => {};
    }

    // Handle WebSocket requestSent event
    const removeWsRequestSentListener = ipc.on('main:ws:request', (requestId, collectionUid, eventData) => {
      dispatch(runWsRequestEvent({
        eventType: 'request',
        itemUid: requestId,
        collectionUid: collectionUid,
        requestUid: requestId,
        eventData
      }));
    });

    const removeWsUpgradeListener = ipc.on('main:ws:upgrade', (requestId, collectionUid, eventData) => {
      dispatch(wsResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'upgrade',
        eventData: eventData
      }));
    });

    const removeWsRedirectListener = ipc.on('main:ws:redirect', (requestId, collectionUid, eventData) => {
      dispatch(wsResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'redirect',
        eventData: eventData
      }));
    });

    // Handle WebSocket message event
    const removeWsMessageListener = ipc.on('main:ws:message', (requestId, collectionUid, eventData) => {
      dispatch(wsResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'message',
        eventData: eventData
      }));
    });

    // Handle WebSocket open event
    const removeWsOpenListener = ipc.on('main:ws:open', (requestId, collectionUid, eventData) => {
      dispatch(wsResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'open',
        eventData: eventData
      }));
    });

    // Handle WebSocket close event
    const removeWsCloseListener = ipc.on('main:ws:close', (requestId, collectionUid, eventData) => {
      dispatch(wsResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'close',
        eventData: eventData
      }));
    });

    // Handle WebSocket error event
    const removeWsErrorListener = ipc.on('main:ws:error', (requestId, collectionUid, eventData) => {
      dispatch(wsResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'error',
        eventData: eventData
      }));
    });

    // Handle WebSocket connecting event
    const removeWsConnectingListener = ipc.on('main:ws:connecting', (requestId, collectionUid, eventData) => {
      dispatch(wsResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'connecting',
        eventData: eventData
      }));
    });

    const removeWsConnectionsChangedListener = ipc.on('main:ws:connections-changed', (data) => {
      dispatch(updateActiveConnectionsInStore(data));
    });

    return () => {
      removeWsRequestSentListener();
      removeWsUpgradeListener();
      removeWsRedirectListener();
      removeWsMessageListener();
      removeWsOpenListener();
      removeWsCloseListener();
      removeWsErrorListener();
      removeWsConnectingListener();
      removeWsConnectionsChangedListener();
    };
  }, [isElectron]);
};

export default useWsEventListeners;
