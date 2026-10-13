/**
 * How each of a title's files is named in its Files list. A title can hold several files: other
 * versions of it (another encode, an edition), and the parts of a title split across files. The
 * server lists them best version first.
 *
 * A file says which part it is only when the title has parts, and which version it is only when
 * its part has more than one; a title in several parts numbers its versions within each part. So
 * a title that is one file says neither. No React: tested under Node.
 */
export type FileHeading = Readonly<{part?: number; version?: number; edition?: string}>;

export function fileHeadings(files: readonly Readonly<{partIndex?: number; edition?: string}>[]): readonly FileHeading[] {
  const partOf = (file: Readonly<{partIndex?: number}>) => file.partIndex ?? 0;
  const parts = files.some(file => partOf(file) > 0);
  return files.map((file, index) => {
    const inPart = files.filter(other => partOf(other) === partOf(file)).length;
    const version = inPart > 1 ? files.slice(0, index + 1).filter(other => partOf(other) === partOf(file)).length : undefined;
    return {...(parts && partOf(file) > 0 ? {part: partOf(file)} : {}), ...(version ? {version} : {}), ...(file.edition ? {edition: file.edition} : {})};
  });
}
