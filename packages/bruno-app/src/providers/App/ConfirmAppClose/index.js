import React, { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import SaveRequestsModal from './SaveRequestsModal';
import { isElectron } from 'utils/common/platform';
import ipc from 'utils/common/ipc';

const ConfirmAppClose = () => {
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!isElectron()) {
      return;
    }

    const clearListener = ipc.on('main:start-quit-flow', () => {
      setShowConfirmClose(true);
    });

    return () => {
      clearListener();
    };
  }, [isElectron, dispatch, setShowConfirmClose]);

  if (!showConfirmClose) {
    return null;
  }

  return <SaveRequestsModal onClose={() => setShowConfirmClose(false)} />;
};

export default ConfirmAppClose;
