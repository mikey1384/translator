import { css } from '@emotion/css';
import { useState, useEffect } from 'react';
import { useCreditStore } from '../state';
import { colors } from '../styles';

const resetButton = css`
  background: ${colors.danger};
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background: #dc2626;
  }

  &:disabled {
    background: ${colors.grayDark};
    cursor: not-allowed;
  }
`;

export default function AdminResetButton() {
  const { refresh } = useCreditStore();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check if current device is admin device
    const checkAdminStatus = async () => {
      try {
        const [deviceId, adminDeviceId] = await Promise.all([
          window.electron.getDeviceId(),
          window.electron.getAdminDeviceId(),
        ]);
        setIsAdmin(Boolean(adminDeviceId && deviceId === adminDeviceId));
      } catch (error) {
        console.error('Failed to check admin status:', error);
      }
    };

    checkAdminStatus();
  }, []);

  const handleReset = async () => {
    if (!isAdmin || loading) return;

    setLoading(true);
    try {
      const result = await window.electron.resetCredits();

      if (result.success) {
        console.log(
          `✅ Credits reset successful: Added ${result.creditsAdded} credits`
        );
        // Refresh credit balance
        await refresh();
      } else {
        console.error('❌ Credit reset failed:', result.error);
        alert(`Credit reset failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Credit reset error:', error);
      alert(`Credit reset error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  // Only render for admin
  if (!isAdmin) return null;

  return (
    <button
      className={resetButton}
      onClick={handleReset}
      disabled={loading}
      title="Admin: Add 5h test credits (250,000 credits)"
    >
      {loading ? '🔄 Adding credits...' : '➕ Add 250,000 Credits'}
    </button>
  );
}
