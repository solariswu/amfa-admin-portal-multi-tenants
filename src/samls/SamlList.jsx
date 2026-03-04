import { useState, useEffect } from "react";
import { List, ResourceContextProvider, TopToolbar, CreateButton, Datagrid, TextField, FunctionField, Confirm, useDelete, BooleanField, Button } from "react-admin"
import awsmobile from '../aws-export';
import { getApiHeaders } from '../utils/apiHeaders';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import NotInterestedIcon from '@mui/icons-material/NotInterested';
import VerifiedIcon from '@mui/icons-material/Verified';

const apiUrl = awsmobile.aws_backend_api_url;

export const SAMLList = (props) => {
    const [configData, setConfigData] = useState(null);
    const [confirm, setConfirm] = useState(null);

    const [deleteOne, { isLoading: isDeleting }] = useDelete();

    useEffect(() => {
        const fetchFeConfigs = async () => {
            let response = await fetch(`${apiUrl}/amfaconfig`, {
                headers: getApiHeaders(),
            })
            let data = await response.json();
            setConfigData(data);
        }

        fetchFeConfigs();

    }, [])
    const ListActions = () => {
        return (
            <TopToolbar>
                <CreateButton />
            </TopToolbar>
        );
    }

    if (!configData) {
        return <CircularProgress sx={{ marginRight: 1 }} size={18} thickness={2} />
    }

    if (!configData.samlProxyEnabled) {
        return (
            <Container style={{ padding: '20px' }}>
                <Typography variant="body2">SAML Proxy is not enabled!</Typography>
            </Container>
        )
    }

    return (
        <ResourceContextProvider value='samls'>
            <Confirm
                isOpen={confirm !== null || isDeleting}
                loading={isDeleting}
                title={isDeleting ? 'Deleting SAML SP' : 'Delete SAML SP'}
                content={
                    isDeleting ?
                        <div style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                        }}> <CircularProgress /> </div> :
                        'Are you sure you want to delete this saml service provider?'}
                onConfirm={() => { deleteOne('samls', { id: confirm?.id }); setConfirm(null) }}
                onClose={() => setConfirm(null)}
            />
            <List  {...props}
                perPage={10}
                exporter={false}
                actions={<ListActions />}
            >
                <Datagrid rowClick={/*false*/"show"} bulkActionButtons={false} optimized key={configData}>
                    <TextField source="name" />
                    <TextField source="entityId" sx={{ overflowWrap: "break-word", wordWrap: "break-word",wordBreak: "break-word" }} />
                    <FunctionField label="SP Login URL"  sx={{ overflowWrap: "break-word", wordWrap: "break-word",wordBreak: "break-word" }}  render={record => record.serviceUrl ?
                        <a href={record.serviceUrl} rel="noreferrer" target="_blank">
                            {record.serviceUrl.length > 150 ?
                                record.serviceUrl.substring(0, 40) + '...' + record.serviceUrl.substring(record.serviceUrl.length - 20, record.serviceUrl.length) :
                                record.serviceUrl}
                        </a> : ''
                    } />
                    <FunctionField label="Metadata"  sx={{ overflowWrap: "break-word", wordWrap: "break-word",wordBreak: "break-word" }}  render={record => record.metadataUrl ?
                        <a href={record.metadataUrl} rel="noreferrer" target="_blank">Download SP Metadata</a> : ''
                    } />
                    <BooleanField source="released" label="Show to end user"
                        TrueIcon={VerifiedIcon} FalseIcon={NotInterestedIcon} />
                    <FunctionField label="Logo" render={record => record.logoUrl ?
                        <img src={record.logoUrl} alt="logo" width="48" height="48" /> : ''
                    } />
                    <Button label="Edit" color="primary" icon="Edit" />
                </Datagrid>
            </List>
        </ResourceContextProvider>
    )
}