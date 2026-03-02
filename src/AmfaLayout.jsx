import { Layout } from 'react-admin';

import { AmfaAppBar } from './AmfaAppBar';
import { AmfaMenu } from './AmfaMenu';

export const AmfaLayout = props => <Layout {...props} appBar={AmfaAppBar} menu={AmfaMenu} />;