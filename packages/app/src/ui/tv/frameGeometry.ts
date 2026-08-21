export const TV_FRAME_GEOMETRY = Object.freeze({
  contentGap: 56,
  railCollapsedWidth: 80,
  railExpandedWidth: 280,
  railLeft: 24,
});

export const TV_COLLAPSED_CONTENT_INSET =
  TV_FRAME_GEOMETRY.railCollapsedWidth + TV_FRAME_GEOMETRY.contentGap;
export const TV_EXPANDED_CONTENT_INSET =
  TV_FRAME_GEOMETRY.railExpandedWidth + TV_FRAME_GEOMETRY.contentGap;
