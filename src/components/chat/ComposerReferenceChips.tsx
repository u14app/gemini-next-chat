"use client";

import React from "react";
import { Cable, ScrollText, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export interface ComposerReference {
  id: string;
  title: string;
}

interface ComposerReferenceChipsProps {
  skills: ComposerReference[];
  plugins: ComposerReference[];
  onRemoveSkill: (id: string) => void;
  onRemovePlugin: (id: string) => void;
  skillsLabel: string;
  pluginsLabel: string;
  removeSkillLabel: (title: string) => string;
  removePluginLabel: (title: string) => string;
}

const chipFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const Chip: React.FC<{
  title: string;
  removeLabel: string;
  onRemove: () => void;
  icon: LucideIcon;
  className: string;
  removeClassName: string;
}> = ({
  title,
  removeLabel,
  onRemove,
  icon: Icon,
  className,
  removeClassName,
}) => (
  <li
    className={`inline-flex max-w-56 shrink-0 items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-1 text-xs font-medium ${className}`}
  >
    <Icon size={11} className="shrink-0" aria-hidden="true" />
    <span className="truncate">{title}</span>
    <Button
      variant="bare"
      type="button"
      aria-label={removeLabel}
      onClick={onRemove}
      className={`shrink-0 rounded-full p-0.5 transition-colors ${removeClassName} ${chipFocusClass}`}
    >
      <X size={10} aria-hidden="true" />
    </Button>
  </li>
);

/**
 * Skills and plugins pulled in with `/` and `@` are forced onto the next
 * message only. Referenced conversations are not shown here — they become real
 * attachments and live in the attachment tray instead.
 */
const ComposerReferenceChips: React.FC<ComposerReferenceChipsProps> = ({
  skills,
  plugins,
  onRemoveSkill,
  onRemovePlugin,
  skillsLabel,
  pluginsLabel,
  removeSkillLabel,
  removePluginLabel,
}) => {
  if (skills.length === 0 && plugins.length === 0) return null;
  const listLabel =
    skills.length > 0 && plugins.length > 0
      ? `${skillsLabel}, ${pluginsLabel}`
      : skills.length > 0
        ? skillsLabel
        : pluginsLabel;

  return (
    <ul
      className="custom-scrollbar flex flex-wrap items-center gap-1.5 px-3 pt-3"
      aria-label={listLabel}
    >
      {skills.map((skill) => (
        <Chip
          key={`skill-${skill.id}`}
          title={skill.title}
          removeLabel={removeSkillLabel(skill.title)}
          onRemove={() => onRemoveSkill(skill.id)}
          icon={ScrollText}
          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          removeClassName="hover:bg-emerald-500/20 focus-visible:ring-emerald-500/50"
        />
      ))}
      {plugins.map((plugin) => (
        <Chip
          key={`plugin-${plugin.id}`}
          title={plugin.title}
          removeLabel={removePluginLabel(plugin.title)}
          onRemove={() => onRemovePlugin(plugin.id)}
          icon={Cable}
          className="border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
          removeClassName="hover:bg-cyan-500/20 focus-visible:ring-cyan-500/50"
        />
      ))}
    </ul>
  );
};

export default ComposerReferenceChips;
