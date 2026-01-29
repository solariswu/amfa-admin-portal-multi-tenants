import { OrganizationList } from './OrganizationList';
import { OrganizationCreate } from './OrganizationCreate';
import OrganizationEdit from './OrganizationEdit';
import { OrganizationShow } from './OrganizationShow';
import BusinessIcon from '@mui/icons-material/Business';

const organizations = {
  list: OrganizationList,
  create: OrganizationCreate,
  edit: OrganizationEdit,
  show: OrganizationShow,
  icon: BusinessIcon,
  recordRepresentation: 'name',
};

export default organizations;
