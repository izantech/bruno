import { useEffect } from 'react';
import { grpcResponseReceived, runGrpcRequestEvent } from 'providers/ReduxStore/slices/collections/index';
import { useDispatch } from 'react-redux';
import { isElectron } from 'utils/common/platform';
import { updateActiveConnectionsInStore } from 'providers/ReduxStore/slices/collections/actions';
import ipc from 'utils/common/ipc';

const useGrpcEventListeners = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    if (!isElectron()) {
      return () => {};
    }

    // Handle gRPC requestSent event
    const removeGrpcRequestSentListener = ipc.on('grpc:request', (requestId, collectionUid, eventData) => {
      dispatch(runGrpcRequestEvent({
        eventType: 'request',
        itemUid: requestId,
        collectionUid: collectionUid,
        requestUid: requestId,
        eventData
      }));
    });

    const removeGrpcMessageSentListener = ipc.on('grpc:message', (requestId, collectionUid, eventData) => {
      dispatch(runGrpcRequestEvent({
        eventType: 'message',
        itemUid: requestId,
        collectionUid: collectionUid,
        requestUid: requestId,
        eventData
      }));
    });

    // Handle gRPC response event (for unary calls and streaming)
    const removeGrpcResponseListener = ipc.on(`grpc:response`, (requestId, collectionUid, data) => {
      dispatch(grpcResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'response',
        eventData: data
      }));
    });

    // Handle gRPC metadata
    const removeGrpcMetadataListener = ipc.on(`grpc:metadata`, (requestId, collectionUid, data) => {
      dispatch(grpcResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'metadata',
        eventData: data
      }));
    });

    // Handle gRPC status updates
    const removeGrpcStatusListener = ipc.on(`grpc:status`, (requestId, collectionUid, data) => {
      dispatch(grpcResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'status',
        eventData: data
      }));
    });

    // Handle gRPC errors
    const removeGrpcErrorListener = ipc.on(`grpc:error`, (requestId, collectionUid, data) => {
      dispatch(grpcResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'error',
        eventData: data
      }));
    });

    // Handle gRPC end event
    const removeGrpcEndListener = ipc.on(`grpc:server-end-stream`, (requestId, collectionUid, data) => {
      dispatch(grpcResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'end',
        eventData: data
      }));
    });

    // Handle gRPC cancel event
    const removeGrpcCancelListener = ipc.on(`grpc:server-cancel-stream`, (requestId, collectionUid, data) => {
      dispatch(grpcResponseReceived({
        itemUid: requestId,
        collectionUid: collectionUid,
        eventType: 'cancel',
        eventData: data
      }));
    });

    const removeGrpcConnectionsChangedListener = ipc.on(`grpc:connections-changed`, (data) => {
      dispatch(updateActiveConnectionsInStore(data));
    });

    return () => {
      removeGrpcRequestSentListener();
      removeGrpcMessageSentListener();
      removeGrpcResponseListener();
      removeGrpcMetadataListener();
      removeGrpcStatusListener();
      removeGrpcErrorListener();
      removeGrpcEndListener();
      removeGrpcCancelListener();
      removeGrpcConnectionsChangedListener();
    };
  }, [isElectron]);
};

export default useGrpcEventListeners;
