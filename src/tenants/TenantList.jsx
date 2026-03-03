import { 
	Toolbar, 
	Button, 
	List, 
	Datagrid, 
	TextField, 
	FunctionField,
	useListContext, 
	CreateButton, 
	TopToolbar,
	useGetList,
	usePermissions,
	Link,
	SelectInput,
	ReferenceInput
} from 'react-admin';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import { Box } from '@mui/material';
import { useState, useEffect, useMemo } from 'react';
import { canCreateTenants } from '../utils/roleUtils';

const resource = 'Tenant';

/**
 * List Actions with role-based CreateButton
 * Only SA and SPA can create tenants
 */
const ListActions = () => {
	const [showCreate, setShowCreate] = useState(false);

	useEffect(() => {
		const token = localStorage.getItem('token');
		setShowCreate(canCreateTenants(token));
	}, []);

	return (
		<TopToolbar>
			{showCreate && <CreateButton />}
		</TopToolbar>
	);
};

const Pagination = () => {
	const { page, perPage, total, setPage } = useListContext();
	const nbPages = Math.ceil(total / perPage) || 1;
	const pages = Object.keys(localStorage.getItem(`${resource}tokenObj`) ? JSON.parse(localStorage.getItem(`${resource}tokenObj`)) : [])
	return (
		nbPages > 1 &&
		<Toolbar>
			{page > 1 &&
				<Button color="primary" key="prev" onClick={() => setPage(page - 1)} >
					<ChevronLeft />
					Prev
				</Button>
			}
			{
				page && pages.map((key, page) => {
					return (<Button color="primary" key={key} onClick={() => setPage(page + 1)}>
						{page + 1}
					</Button>)
				})
			}
			{page !== nbPages &&
				<Button color="primary" key="next" onClick={() => setPage(page + 1)}>
					Next
					<ChevronRight />
				</Button>
			}
		</Toolbar>
	);
}

/**
 * Filters for tenant list (SA only)
 * SA can filter by organization; SPA already sees only their org's tenants
 */
const TenantFiltersSA = [
	<ReferenceInput 
		source="org_id" 
		reference="organizations"
		label="IT Svc Org"
		alwaysOn
	>
		<SelectInput optionText="name" label="IT Svc Org" />
	</ReferenceInput>
];

export const TenantList = props => {
	const { permissions } = usePermissions();
	
	// Only SA sees the org filter; SPA sees only their org's tenants (backend-filtered)
	const tenantFilters = permissions?.isSA ? TenantFiltersSA : [];
	
	// Load organizations to display names
	const { data: organizations, isLoading: orgsLoading } = useGetList('organizations', {
		pagination: { page: 1, perPage: 1000 }
	});
	
	// Create org ID → name mapping
	const orgMap = useMemo(() => {
		if (!organizations) return {};
		return organizations.reduce((map, org) => {
			map[org.id] = org.name;
			return map;
		}, {});
	}, [organizations]);
	
	return (
		<Box sx={{ paddingTop: 5 }}>
			<List  {...props}
				title={"Tenants"} 
				perPage={10} 
				pagination={<Pagination />}
				actions={<ListActions />}
				filters={tenantFilters}
				exporter={false}
			>
				<Datagrid rowClick="show" bulkActionButtons={false} optimized>
					<TextField label="Tenant Name" source="name" sortable={true} />
					<TextField label="Tenant Id" source="id" sortable={true} />
					<FunctionField 
						label="IT Svc Org"
						render={record => {
							const orgName = orgMap[record.org_id] || record.org_id || 'N/A';
							return record.org_id ? (
								<Link to={`/organizations/${record.org_id}/show`}>
									{orgName}
								</Link>
							) : orgName;
						}}
						sortable={false}
					/>
					<TextField label="Contact Email" source="contact" sortable={false} />
					<TextField label="End User Service Provider URL" source="endUserSpUrl" sortable={false} />
					<Button label="Edit" color="primary" />
				</Datagrid>
			</List>
		</Box>
	)
};
