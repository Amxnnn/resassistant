"use client";

import React, { useState } from "react";
import type { Message, SheetState } from "./types";
import { MESSAGE_STATUS, relativeTime, TOPIC_LABEL } from "./format";
import { Chevron, Empty, PageHead, Segmented, SkeletonRows, Status } from "./ui";

type Filter = "new" | "in_progress" | "resolved" | "all";

export function Messages({
  messages,
  now,
  loading,
  onOpen
}: {
  messages: Message[];
  now: Date;
  loading: boolean;
  onOpen: (sheet: SheetState) => void;
}) {
  const [filter, setFilter] = useState<Filter>("new");
  const count = (id: string) => messages.filter(m => m.status === id).length;
  const list = messages
    .filter(m => filter === "all" || m.status === filter)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const emptyCopy: Record<Filter, string> = {
    new: "You're all caught up. When a caller asks for the manager, the receptionist takes a message and it lands here.",
    in_progress: "Messages you've started on appear here.",
    resolved: "Messages you've dealt with appear here.",
    all: "When a caller asks about a large party, an event or catering, the receptionist takes a message for the manager."
  };

  return (
    <div className="page page-narrow">
      <PageHead
        title="Messages"
        sub="Requests the receptionist took for the manager: large parties, events, catering and callbacks."
      />

      <div className="toolbar">
        <Segmented<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "new", label: count("new") ? `New ${count("new")}` : "New" },
            { id: "in_progress", label: "In progress" },
            { id: "resolved", label: "Resolved" },
            { id: "all", label: "All" }
          ]}
        />
      </div>

      {loading ? (
        <SkeletonRows count={4} />
      ) : list.length === 0 ? (
        <div className="group">
          <Empty title={filter === "new" ? "No new messages" : "Nothing here"} body={emptyCopy[filter]} />
        </div>
      ) : (
        <div className="group">
          {list.map(m => {
            const status = MESSAGE_STATUS.find(s => s.id === m.status);
            return (
              <button key={m.id} type="button" className="row row-has-lead" onClick={() => onOpen({ kind: "message", id: m.id })}>
                <span className="row-lead">{m.status === "new" && <span className="unread-dot" aria-label="New" />}</span>
                <span className="row-main">
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span className="row-title" style={{ fontWeight: m.status === "new" ? 600 : 500 }}>
                      {m.callerName}
                    </span>
                    <span className="row-trail">{relativeTime(m.createdAt, now)}</span>
                  </span>
                  <span className="row-sub" style={{ display: "flex", gap: 10 }}>
                    <span>{TOPIC_LABEL[m.topic] || m.topic}</span>
                    {filter === "all" && status && <Status dot={status.dot}>{status.label}</Status>}
                  </span>
                  <span className="row-body">{m.details}</span>
                </span>
                <Chevron />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
