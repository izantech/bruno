import { useEffect } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { hasNativeHost } from 'utils/common/platform';
import ipc from 'utils/common/ipc';
import subscribeIpcEvents from './ipcEventHandlers';

const useIpcEvents = () => {
  const dispatch = useDispatch();
  const store = useStore();

  useEffect(() => {
    if (!hasNativeHost()) {
      return () => {};
    }

    ipc.invoke('renderer:ready');

    return subscribeIpcEvents(ipc, { dispatch, store });
  }, [dispatch, store]);
};

export default useIpcEvents;
