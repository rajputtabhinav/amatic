import { DefaultSidebar, Sidebar, THEME } from "@amatic/amatic";
import {
  messageCircleIcon,
  presentationIcon,
} from "@amatic/amatic/components/icons";
import { LinkButton } from "@amatic/amatic/components/LinkButton";
import { useUIAppState } from "@amatic/amatic/context/ui-appState";

import { AgenticChat } from "./chat/AmaticChat";

import "./AppSidebar.scss";

export interface AppSidebarProps {
  onVisualExplanationRequest?: (topic: string, content: string) => void;
  canvasContext?: Record<string, unknown> | null;
}

export const AppSidebar = ({
  onVisualExplanationRequest,
  canvasContext,
}: AppSidebarProps) => {
  const { theme, openSidebar } = useUIAppState();

  return (
    <DefaultSidebar>
      <DefaultSidebar.TabTriggers>
        <Sidebar.TabTrigger
          tab="comments"
          style={{ opacity: openSidebar?.tab === "comments" ? 1 : 0.4 }}
        >
          {messageCircleIcon}
        </Sidebar.TabTrigger>
        <Sidebar.TabTrigger
          tab="presentation"
          style={{ opacity: openSidebar?.tab === "presentation" ? 1 : 0.4 }}
        >
          {presentationIcon}
        </Sidebar.TabTrigger>
      </DefaultSidebar.TabTriggers>
      <Sidebar.Tab tab="comments">
        <div className="app-sidebar-comments-container">
          <AgenticChat
            onVisualExplanationRequest={onVisualExplanationRequest}
            canvasContext={canvasContext}
          />
        </div>
      </Sidebar.Tab>
      <Sidebar.Tab tab="presentation" className="px-3">
        <div className="app-sidebar-promo-container">
          <div
            className="app-sidebar-promo-image"
            style={{
              ["--image-source" as any]: `url(/oss_promo_presentations_${
                theme === THEME.DARK ? "dark" : "light"
              }.svg)`,
              backgroundSize: "60%",
              opacity: 0.4,
            }}
          />
          <div className="app-sidebar-promo-text">
            Presentation feature coming soon!
          </div>
          {/* Amatic+ sign up button removed - no external redirects */}
        </div>
      </Sidebar.Tab>
    </DefaultSidebar>
  );
};
