import { Outlet, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { PortalShell, rememberChild } from './portal-shell';

/**
 * The frame of the parent portal (task 11.2, pull request #294; `10`, What parents see: "switches
 * between children at the top of the page"): the portal's shell around the page of the child in
 * the address. The child switcher lists each child the server answers (an open link, portal
 * access on, active, in any branch); switching keeps the page.
 */
export function PortalFrame(): React.JSX.Element {
  const params: { studentId?: string } = useParams({ strict: false });
  const studentId = params.studentId;
  useEffect(() => {
    if (studentId !== undefined) rememberChild(studentId);
  }, [studentId]);
  return (
    <PortalShell studentId={studentId}>
      <Outlet />
    </PortalShell>
  );
}
