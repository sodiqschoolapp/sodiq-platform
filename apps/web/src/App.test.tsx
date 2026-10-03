import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

/** Replaces the browser's fetch with answers given in order; the last one repeats. */
function stubFetch(...answers: (() => Promise<Response>)[]) {
  const fetchMock = vi.fn<typeof fetch>();
  answers.forEach((answer, index) => {
    if (index === answers.length - 1) fetchMock.mockImplementation(answer);
    else fetchMock.mockImplementationOnce(answer);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ok = () => Promise.resolve(Response.json({ status: 'ok' }));
const networkError = () => Promise.reject(new TypeError('Failed to fetch'));

// docs/build-plan.md, task 0.1: the web app shows a placeholder page that calls an API
// health route. .claude/rules/web.md: every screen has loading and error states.
describe('placeholder page', () => {
  it('shows "checking" first and "reachable" when the API answers', async () => {
    const fetchMock = stubFetch(ok);

    render(<App />);

    expect(screen.getByRole('status').textContent).toBe('API: checking…');
    await screen.findByText('API: reachable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/health');
  });

  it.each([
    ['the call fails', networkError],
    ['the server answers with an error', () => Promise.resolve(new Response('', { status: 502 }))],
    ['the answer is not JSON', () => Promise.resolve(new Response('<html></html>'))],
    ['the answer has another shape', () => Promise.resolve(Response.json({ status: 'down' }))],
  ])('shows "not reachable" and what to do when %s', async (_name, answer) => {
    stubFetch(answer);

    render(<App />);

    await screen.findByText('API: not reachable');
    expect(screen.getByText(/The API did not answer/)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Check again' }).disabled).toBe(
      false,
    );
  });

  it('calls the API again when "Check again" is pressed', async () => {
    const fetchMock = stubFetch(networkError, ok);

    render(<App />);
    await screen.findByText('API: not reachable');

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));

    await screen.findByText('API: reachable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/The API did not answer/)).toBeNull();
  });
});
