import * as React from 'react';
import Typography from '@mui/material/Typography';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';

import { ArrayInput, BooleanInput, FormDataConsumer, SimpleFormIterator, TextInput, required } from 'react-admin';
import { Box, IconButton } from '@mui/material';
import { isHttpsOrHttpLocal } from '../../utils/validation';
// import { SPPortalUrl } from '/amfaext.js';

export default function ServiceProviderForm(props) {
    const [selected, setSelected] = React.useState(null)

    const handleClick = (spname) => {
        if (selected === spname) {
            setSelected(null)
        } else {
            setSelected(spname)
        }
    }

    return (
        <React.Fragment>
            <Typography variant="h6" gutterBottom>
                Service Provider List</Typography>
            <ArrayInput fullWidth
                source="serviceProviders"
                required>
                <Typography  variant="body">Provide a name, take defaults. Edit details after creation.</Typography>
                <SimpleFormIterator fullWidth disableClear disableReordering >
                    <FormDataConsumer>
                        {({
                            formData, // The whole form data
                            scopedFormData, // The data for this item of the ArrayInput
                            // source, // A function to get the valid source inside an ArrayInput
                            ...rest
                        }) => {
                            // console.log('spformdata', scopedFormData, ' selected', selected, 'getSource', getSource('spname'))
                            // console.log('spformdata', scopedFormData, ' selected', selected )
                            return (
                                <>
                                    <Box sx={{ display: 'flex', mb: 2 }} onClick={() => handleClick(scopedFormData['spname'])} >
                                        <IconButton><DriveFileRenameOutlineIcon color='primary' /></IconButton>
                                        <Typography variant='h6' >{scopedFormData.spname}</Typography>
                                    </Box>

                                    {
                                        (
                                            (scopedFormData && scopedFormData['spname'] === selected) ||
                                            (!scopedFormData.spname)
                                        ) && (<>
                                            <TextInput
                                                fullWidth
                                                label="Service Provider Name"
                                                source="spname"
                                                validate={[required()]}
                                                onChange={() => setSelected(scopedFormData['spname'])}
                                            />
                                            <TextInput
                                                fullWidth
                                                label="Service Provider SignIn Callback/Redirect URL"
                                                source="spcallback"
                                                validate={[required(), isHttpsOrHttpLocal]}
                                                placeholder='http://localhost'
                                                // defaultValue={'http://localhost'}
                                            />
                                            <TextInput
                                                fullWidth
                                                label="Service Provider Logout Callback"
                                                source="splogoutcallback"
                                                validate={[isHttpsOrHttpLocal]}
                                            />
                                            <TextInput
                                                fullWidth
                                                label="Service Provider Login Url"
                                                source="sploginurl"
                                                validate={[required()]}
                                                // placeholder={SPPortalUrl}
                                                // defaultValue={SPPortalUrl}
                                            />
                                            <TextInput
                                                fullWidth
                                                label="Service Provider Logo Url (Image Size 25x25)"
                                                source="splogourl"
                                            />
                                            <BooleanInput
                                                fullWidth
                                                label="Show to end users"
                                                source="released"
                                            />
                                        </>)
                                    }
                                </>
                            )
                        }}
                    </FormDataConsumer >
                </SimpleFormIterator>
            </ArrayInput>

        </React.Fragment>
    );
}