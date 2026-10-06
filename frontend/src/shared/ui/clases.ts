/** Une clases ignorando las vacias, false y undefined. */
export function clases(...valores: Array<string | false | undefined | null>): string {
  return valores.filter(Boolean).join(' ');
}
