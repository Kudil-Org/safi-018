import { useCallback, useMemo } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive
} from "@assistant-ui/react";
import { useWindmillRuntime } from "@windmill-labs/chat-sdk/assistant-ui";
import type { WindmillSession } from "../types";

interface AssistantPaneProps {
  session: WindmillSession;
  userId: string;
  artifactId: string | null;
  getAccessToken: () => Promise<string>;
  onArtifactChanged: () => void;
}

function ChatMessage({ role }: { role: string }) {
  return (
    <MessagePrimitive.Root className={`message message-${role}`}>
      <div className="message-avatar" aria-hidden="true">
        {role === "user" ? "You" : "S"}
      </div>
      <div className="message-body">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

export function AssistantPane({
  session,
  userId,
  artifactId,
  getAccessToken,
  onArtifactChanged
}: AssistantPaneProps) {
  const token = useCallback(() => getAccessToken(), [getAccessToken]);

  const inputs = useMemo(
    () => ({
      safi_context: session.context,
      artifact_id: artifactId
    }),
    [session.context, artifactId]
  );

  const onFinish = useCallback(() => {
    onArtifactChanged();
  }, [onArtifactChanged]);

  const runtime = useWindmillRuntime({
    baseUrl: window.location.origin,
    workspace: session.workspace,
    flowPath: session.flowPath,
    token,
    history: "local",
    storageKey: userId,
    inputs,
    threadList: false,
    onFinish
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat-thread">
        <div className="pane-header">
          <div>
            <p className="eyebrow">Assistant</p>
            <h2>SAFI follow-up assistant</h2>
          </div>
          <span className="live-dot" title="Connected to the deployed Windmill Flow">
            Live
          </span>
        </div>

        <ThreadPrimitive.Viewport className="chat-viewport" autoScroll>
          <ThreadPrimitive.Empty>
            <div className="empty-chat">
              <div className="empty-chat-mark" aria-hidden="true">
                S
              </div>
              <h3>Plan the follow-up</h3>
              <p>
                Ask the Assistant to draft a checklist, update items, or find a real Calnode slot.
                Every checklist change is versioned.
              </p>
              <ul>
                <li>“Create a follow-up checklist for my meeting.”</li>
                <li>“Add a task to send the notes.”</li>
                <li>“Find a 30-minute slot next week.”</li>
              </ul>
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages>
            {({ message }) => <ChatMessage role={message.role} />}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>

        <ComposerPrimitive.Root className="composer">
          <ComposerPrimitive.Input
            className="composer-input"
            placeholder="Ask for a checklist change or a booking slot..."
            rows={1}
            submitMode="enter"
          />
          <div className="composer-actions">
            <span className="composer-hint">Enter to send · Shift+Enter for a new line</span>
            <ComposerPrimitive.Send className="primary-button">Send</ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
