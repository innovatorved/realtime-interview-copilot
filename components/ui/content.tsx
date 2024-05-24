"use client";
import * as React from "react";

import { cn } from "@/lib/utils";

interface ContentDataProps extends React.HTMLAttributes<string> {
  contentMaxLength?: number;
}

const ContentData = React.forwardRef<HTMLDivElement, ContentDataProps>(
  ({ className, contentMaxLength, ...props }, ref) => {
    const [expanded, setExpanded] = React.useState(false);
    const contentRef = React.useRef<string>(props.children as string);

    React.useEffect(() => {
      if (contentRef.current) {
        const contentHeight = contentRef.current.length;
        const isContentDataOverflowing = contentHeight > contentMaxLength!;
        if (isContentDataOverflowing) {
          setExpanded(false);
        }
      }
    }, [contentMaxLength]);

    const handleToggleExpand = () => {
      setExpanded(!expanded);
    };

    return (
      <div className={cn("pt-0", className)} ref={ref}>
        {expanded ? (
          <>
            {props.children}
            <button
              type="button"
              className="text-xs text-green-500 underline ml-2"
              onClick={handleToggleExpand}
            >
              show less
            </button>
          </>
        ) : (
          <>
            {React.Children.count(props.children) < (contentMaxLength ?? 0) && (
              <button type="button" className="" onClick={handleToggleExpand}>
                {React.Children.toArray(props.children)[0]
                  .valueOf()
                  .toLocaleString()
                  .slice(0, contentMaxLength)}
                ...
              </button>
            )}
          </>
        )}
      </div>
    );
  },
);
ContentData.displayName = "ContentData";

export { ContentData };
