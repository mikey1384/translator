import React, { useEffect, useRef, useState } from 'react';
import { addEvent, removeEvent } from '../listenerHelpers';

export default function useScrollToBottom(
  containerRef: React.RefObject<any>,
  threshold = 0
) {
  const timerRef: React.MutableRefObject<any> = useRef(null);
  const [atBottom, setAtBottom] = useState(false);
  const appElement = document.getElementById('App');
  const appElementScrollTop = appElement?.scrollTop || 0;
  const [scrollTop, setScrollTop] = useState<number>(appElementScrollTop);

  useEffect(() => {
    if (containerRef.current?.clientHeight - scrollTop < window.innerHeight) {
      setAtBottom(true);
    }
    addEvent(window, 'scroll', onScroll);
    addEvent(document.getElementById('App'), 'scroll', onScroll);

    function onScroll() {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const appElement = document.getElementById('App');
        const appElementScrollTop = appElement?.scrollTop || 0;
        if (
          containerRef.current?.clientHeight - appElementScrollTop <
          window.innerHeight + threshold
        ) {
          setAtBottom(true);
        } else {
          setAtBottom(false);
        }
        setScrollTop(appElementScrollTop);
      }, 50);
    }

    return function cleanUp() {
      removeEvent(window, 'scroll', onScroll);
      removeEvent(document.getElementById('App'), 'scroll', onScroll);
    };
  }, [containerRef, scrollTop, threshold]);

  return { atBottom, scrollTop };
}
