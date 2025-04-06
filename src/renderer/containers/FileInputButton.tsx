import React from 'react';
import Button from '../components/Button.js';

interface FileInputButtonProps {
  children: React.ReactNode;
  onClick: () => void;
}

function FileInputButton({ children, onClick }: FileInputButtonProps) {
  return (
    <Button
      // style={{ width: '10rem' }} // Remove fixed width
      onClick={onClick}
      variant="secondary" // Change variant back to secondary
      size="lg" // Increase size
    >
      {/* Add Upload Icon */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ marginRight: '8px' }}
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      {children}
    </Button>
  );
}

export default FileInputButton;
