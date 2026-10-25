export function fieldValue(event: Event): string {
  const target = event.target;
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
    ? target.value
    : '';
}

export function fieldChecked(event: Event): boolean {
  return event.target instanceof HTMLInputElement && event.target.checked;
}
