import { Outlet } from 'react-router-dom';
import AppHeader from './AppHeader';

export default function AppLayout() {
  return (
    <>
      <AppHeader />
      <main><Outlet /></main>
    </>
  );
}
