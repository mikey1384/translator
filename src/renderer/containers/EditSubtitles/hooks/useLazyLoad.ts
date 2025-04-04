import { useEffect, useRef } from 'react';

export function useLazyLoad({
  itemRef,
  inView,
  onSetPlaceholderHeight,
  onSetIsVisible,
  delay = 1000,
}: {
  itemRef: React.RefObject<any>;
  inView: boolean;
  onSetPlaceholderHeight?: (height: number) => void;
  onSetIsVisible?: (visible: boolean) => void;
  delay?: number;
}) {
  const timerRef = useRef<any>(null);
  const inViewRef = useRef(inView);

  useEffect(() => {
    inViewRef.current = inView;
    if (!inView) {
      timerRef.current = setTimeout(() => {
        onSetIsVisible?.(false);
      }, delay);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      onSetIsVisible?.(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, delay]);

  useEffect(() => {
    const handleResize = throttle((entries: ResizeObserverEntry[]) => {
      if (entries.length > 0) {
        const clientHeight = entries[0].target.clientHeight;
        onSetPlaceholderHeight?.(clientHeight);
      }
    }, 100);

    const resizeObserver = new ResizeObserver(handleResize);

    if (itemRef.current) {
      resizeObserver.observe(itemRef.current);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemRef]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}

function throttle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number = 100
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  return function (...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    // Clear any existing timeout
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      callback(...args);
    } else {
      lastArgs = args;
      timeoutId = window.setTimeout(() => {
        if (lastArgs) {
          lastCall = Date.now();
          callback(...lastArgs);
          lastArgs = null;
          timeoutId = null;
        }
      }, delay - timeSinceLastCall);
    }
  };
}
