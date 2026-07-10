import { GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "@/lib/utils";

// react-resizable-panels v4: the group is `Group` with an `orientation` prop and
// it manages its own flex-direction. Orientation is not exposed as a CSS data
// attribute, so the resize handle takes an explicit `orientation` to render the
// grip on the correct axis.

const ResizablePanelGroup = ({ className, ...props }: React.ComponentProps<typeof Group>) => (
  <Group className={cn("flex h-full w-full", className)} {...props} />
);

const ResizablePanel = Panel;

const ResizableHandle = ({
  withHandle,
  orientation = "horizontal",
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean;
  orientation?: "horizontal" | "vertical";
}) => (
  <Separator
    className={cn(
      "relative flex items-center justify-center bg-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
      orientation === "horizontal" ? "w-px" : "h-px w-full",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div
        className={cn(
          "z-10 flex items-center justify-center rounded-sm border bg-border",
          orientation === "horizontal" ? "h-4 w-3" : "h-3 w-4",
        )}
      >
        <GripVertical className={cn("h-2.5 w-2.5", orientation === "vertical" && "rotate-90")} />
      </div>
    )}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
