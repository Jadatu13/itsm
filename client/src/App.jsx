import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import TicketList from './pages/TicketList'
import TicketDetail from './pages/TicketDetail'
import Contacts from './pages/Contacts'
import ContactDetail from './pages/ContactDetail'
import Organisations from './pages/Organisations'
import Settings from './pages/Settings'
import Agents from './pages/Agents'
import CannedResponses from './pages/CannedResponses'
import KnowledgeBase from './pages/KnowledgeBase'
import Reports from './pages/Reports'
import Automations from './pages/Automations'
import ServiceCatalog from './pages/ServiceCatalog'
import ApprovalQueue from './pages/ApprovalQueue'
import M365Tenants from './pages/M365Tenants'
import PortalBranding from './pages/PortalBranding'
import PortalLogin from './pages/portal/PortalLogin'
import PortalApp from './pages/portal/PortalApp'
import PortalDashboard from './pages/portal/PortalDashboard'
import PortalTickets from './pages/portal/PortalTickets'
import PortalTicketDetail from './pages/portal/PortalTicketDetail'
import PortalKB from './pages/portal/PortalKB'
import PortalArticle from './pages/portal/PortalArticle'
import PortalServiceCatalog from './pages/portal/PortalServiceCatalog'
import PortalServiceRequest from './pages/portal/PortalServiceRequest'

function ProtectedRoute({ children }) {
  const { agent, loading } = useAuth()
  if (loading) return <div style={{ padding: 40, color: '#888' }}>Loading…</div>
  if (!agent)  return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Portal routes — completely separate from agent UI */}
          <Route path="/portal/login" element={<PortalLogin />} />
          <Route path="/portal" element={<PortalApp />}>
            <Route index element={<Navigate to="/portal/dashboard" replace />} />
            <Route path="dashboard"             element={<PortalDashboard />} />
            <Route path="tickets"               element={<PortalTickets />} />
            <Route path="tickets/:id"           element={<PortalTicketDetail />} />
            <Route path="kb"                    element={<PortalKB />} />
            <Route path="kb/:id"                element={<PortalArticle />} />
            <Route path="service-catalog"       element={<PortalServiceCatalog />} />
            <Route path="service-catalog/:id"   element={<PortalServiceRequest />} />
          </Route>

          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"     element={<Dashboard />} />
            <Route path="/tickets"       element={<TicketList />} />
            <Route path="/tickets/:id"   element={<TicketDetail />} />
            <Route path="/contacts"      element={<Contacts />} />
            <Route path="/contacts/:id"  element={<ContactDetail />} />
            <Route path="/organisations" element={<Organisations />} />
            <Route path="/kb"            element={<KnowledgeBase />} />
            <Route path="/reports"       element={<Reports />} />
            <Route path="/automations"   element={<Automations />} />
            <Route path="/service-catalog" element={<ServiceCatalog />} />
            <Route path="/approval-queue"  element={<ApprovalQueue />} />
            <Route path="/m365-tenants"    element={<M365Tenants />} />
            <Route path="/settings"      element={<Settings />} />
            <Route path="/settings/agents"          element={<Agents />} />
            <Route path="/settings/canned-responses" element={<CannedResponses />} />
            <Route path="/portal-branding" element={<PortalBranding />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
