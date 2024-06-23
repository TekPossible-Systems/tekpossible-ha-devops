# TekPossible HA DevOps Architecture Overview

## System Workflow Notes 

There should be 3 different types of systems

1. Development Systems - These are systems that are only accessible by the development team - they do not have external connections and therefore do not produce value besides development

2. QA/Canary Systems - Once software makes it out of dev, it will get deployed to qa/canary. These systems mirror the production systems in all but avaliablity zones and the software version they are running. They are not operational, and are undergoing QA tests.

3. Production Systems - These are the real, important, systmems. They have external connections and are not undergoing any tests. They have a minimum of 2 AZs. 

## Repository Architecture Notes

There are 4 repos that make up the systems

1. Software Repo - the repo where the actual deployed software lives

2. Image Repo - the repo where the information to build a fully functioning, and custom AMI live.

3. Infrastructure Repo - the repo where the infrastructure that supports the AMI/Software lives. Things like the VPC are created here.

4. DevOps Infrastructure Repo - this repo, which maintains the infrastructure that controls the repos, and their pipelines to deploy the first 3 repos.

Each of the above systems maps to a branch in the first three repos. This is because we definitely want to be able to push to just dev, or just qa. 

The three branches are as follows:

Development Systems -> dev

QA/Canary Systems -> qa

Production Systems -> main

## SDLC Notes

Lets say a developer wants to test their code on the development systems. They create a PR to merge into the "dev" branch, and their PR is approved and merged into dev. 

Since committing to the dev branch triggers a pipeline, the software is now built/packaged for the development system, and made into a tar file. The tag then get committed to the Image Repo's config.json file on the image repo's "dev" branch. 

Committing to the dev branch on the image repo also triggers a pipeline. The EC2 Image Builder Pipeline is kicked off and the software is pulled on to the EC2 instance that builds the AMI. The EC2 instance is configured with the new software and the other configs mentioned in the AMI repo. At the end of the pipeline, the bew ami id is committed to the infrastructure repo on its "dev" branch.

Committing to the dev branch on the infrastructure repo triggers the infrastructure pipeline. The CDK is synthesized in cloudformation code, and linted. The results of which are turned into reports and saved onto an S3 bucket. The pipeline then awaits manual approval prior to deploying the changes. When approved, the pipeline then deploys the generated template from mentioned s3 bucket. 

The new version of software is now deployed onto the development systems. 

