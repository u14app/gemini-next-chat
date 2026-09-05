"use client";

import { memo } from "react";
import MarkdownRendererClient from "./MarkdownRendererClient";
export type {
  MarkdownRendererProps,
  MarkdownImageSource,
} from "./markdown/types";

export default memo(MarkdownRendererClient);
