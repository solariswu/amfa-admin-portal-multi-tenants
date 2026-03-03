import React, { useState, useEffect } from 'react';
import {
  List,
  Datagrid,
  TextField,
  DateField,
  CreateButton,
  TopToolbar,
  FunctionField,
} from 'react-admin';
import { Box } from '@mui/material';
import { canCreateOrganizations } from '../utils/roleUtils';

/**
 * List Actions with role-based CreateButton
 * Only SA can create organizations
 */
const ListActions = () => {
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    setShowCreate(canCreateOrganizations(token));
  }, []);

  return (
    <TopToolbar>
      {showCreate && <CreateButton />}
    </TopToolbar>
  );
};

/**
 * OrganizationList Component
 * Displays list of all organizations (SA can see all)
 */
export const OrganizationList = (props) => {
  return (
    <Box sx={{ paddingTop: 5 }}>
      <List
        {...props}
        title="IT Svc Orgs"
        perPage={25}
        actions={<ListActions />}
        exporter={false}
        sort={{ field: 'created_at', order: 'DESC' }}
      >
        <Datagrid rowClick="show" bulkActionButtons={false}>
          <TextField source="id" label="IT Svc Org ID" sortable={true} />
          <TextField source="name" label="Name" sortable={true} />
          <FunctionField
            label="Description"
            render={(record) => (
              <span>
                {record.description
                  ? record.description.length > 50
                    ? `${record.description.substring(0, 50)}...`
                    : record.description
                  : '-'}
              </span>
            )}
          />
          <TextField source="created_by" label="Created By" sortable={false} />
          <DateField
            source="created_at"
            label="Created"
            sortable={true}
            showTime
          />
        </Datagrid>
      </List>
    </Box>
  );
};
